import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedPrincipal, PrincipalRole } from '../../../application/security/authenticated-principal';
import { Container } from '../../../infrastructure/container';
import { AdminAuth, AdminAuthSession } from './admin-auth';
import { registerApiErrorHandler } from './error-response';
import { registerAdminProposalRoutes } from './admin-proposal.controller';
import { registerAdminSkillRoutes } from './admin-skill.controller';

function authWithRoles(roles: PrincipalRole[]): AdminAuth {
  const principal: AuthenticatedPrincipal = {
    principalId: 'principal-1',
    kind: 'human',
    externalSubject: 'subject-1',
    issuer: 'https://auth.example.test/application/o/admin/',
    clientId: 'managedskillhub-admin-web',
    displayName: 'Staff User',
    email: null,
    groups: [],
    roles,
    scheme: 'session',
  };
  const session: AdminAuthSession = {
    username: 'Staff User',
    principal,
    roles,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  };
  return {
    mode: 'oidc',
    validate: vi.fn().mockResolvedValue(session),
    validateMutationOrigin: vi.fn(),
    logout: vi.fn(),
  };
}

function container() {
  const skill = { id: { toString: () => 'skill-1' } };
  return {
    reviewSkill: {
      approve: vi.fn().mockResolvedValue(skill),
      publish: vi.fn().mockResolvedValue(skill),
      assertCanPublish: vi.fn().mockResolvedValue(undefined),
    },
    reindexSkillSearch: {
      execute: vi.fn().mockResolvedValue({ indexed: 1 }),
    },
    reviewProposal: {
      convertProposal: vi.fn().mockResolvedValue({
        id: { toString: () => 'skill-1' },
        getAllVersions: () => [],
        getLatestPublishedVersion: () => undefined,
      }),
      rejectProposal: vi.fn().mockResolvedValue({ id: 'proposal-1' }),
    },
    proposalRead: {
      getDetail: vi.fn().mockResolvedValue({ id: 'proposal-1', status: 'judged' }),
      getNotice: vi.fn().mockResolvedValue({ hasNewProposals: true, totalPending: 1, counts: { in_upload: 0, submitted: 1, judged: 0, converted: 0 } }),
    },
    adminSkillRead: {
      getSkillDetail: vi.fn().mockResolvedValue({ versions: [{ version: '1.0.0' }] }),
    },
    operations: {
      start: vi.fn().mockResolvedValue({ id: 'operation-1', state: 'queued', phase: 'queued', message: 'Queued', completed: 0, total: 0 }),
    },
  } as unknown as Container;
}

async function appFor(roles: PrincipalRole[]) {
  const app = Fastify({ logger: false });
  const testContainer = container();
  const auth = authWithRoles(roles);
  registerAdminSkillRoutes(app, testContainer, auth);
  registerAdminProposalRoutes(app, testContainer, auth);
  registerApiErrorHandler(app);
  return { app, testContainer };
}

describe('administrator role route wiring', () => {
  it('lets reviewers approve and reject but not publish or convert', async () => {
    const { app, testContainer } = await appFor(['reviewer']);

    const approve = await app.inject({ method: 'POST', url: '/admin/skills/skill-1/approve?version=1.0.0' });
    const reject = await app.inject({ method: 'POST', url: '/admin/proposals/proposal-1/reject', payload: {} });
    const notice = await app.inject({ method: 'GET', url: '/admin/proposals/notice' });
    const publish = await app.inject({ method: 'POST', url: '/admin/skills/skill-1/publish?version=1.0.0' });
    const convert = await app.inject({ method: 'POST', url: '/admin/proposals/proposal-1/convert', payload: {} });
    const finalizeAndPublish = await app.inject({ method: 'POST', url: '/admin/proposals/proposal-1/finalize-and-publish', payload: {} });

    expect(approve.statusCode).toBe(200);
    expect(reject.statusCode).toBe(200);
    expect(notice.statusCode).toBe(200);
    expect(publish.statusCode).toBe(403);
    expect(convert.statusCode).toBe(403);
    expect(finalizeAndPublish.statusCode).toBe(403);
    expect(testContainer.reviewSkill.publish).not.toHaveBeenCalled();
    expect(testContainer.reviewProposal.convertProposal).not.toHaveBeenCalled();
  });

  it('lets publishers publish and convert but not approve or run admin operations', async () => {
    const { app, testContainer } = await appFor(['publisher']);

    const publish = await app.inject({ method: 'POST', url: '/admin/skills/skill-1/publish?version=1.0.0' });
    const convert = await app.inject({ method: 'POST', url: '/admin/proposals/proposal-1/convert', payload: {} });
    const notice = await app.inject({ method: 'GET', url: '/admin/proposals/notice' });
    const approve = await app.inject({ method: 'POST', url: '/admin/skills/skill-1/approve?version=1.0.0' });
    const reindex = await app.inject({ method: 'POST', url: '/admin/search/reindex' });

    expect(publish.statusCode).toBe(202);
    expect(convert.statusCode).toBe(200);
    expect(notice.statusCode).toBe(403);
    expect(approve.statusCode).toBe(403);
    expect(reindex.statusCode).toBe(403);
    expect(testContainer.reviewSkill.approve).not.toHaveBeenCalled();
    expect(testContainer.reindexSkillSearch.execute).not.toHaveBeenCalled();
    expect(testContainer.operations.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'publish_skill_version', skillId: 'skill-1' }));
  });

  it('lets administrators satisfy specialized and admin-only routes', async () => {
    const { app, testContainer } = await appFor(['admin']);

    expect((await app.inject({ method: 'POST', url: '/admin/skills/skill-1/approve?version=1.0.0' })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST',
      url: '/admin/skills/skill-1/publish?version=1.0.0',
      payload: { judgementOverrideReason: 'Manual security review completed' },
    })).statusCode).toBe(202);
    expect((await app.inject({ method: 'POST', url: '/admin/search/reindex' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/admin/proposals/proposal-1/finalize-and-publish', payload: { comment: 'Approved for publication' } })).statusCode).toBe(202);
    expect(testContainer.operations.start).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'publish_skill_version',
      payload: expect.objectContaining({ judgementOverrideAllowed: true, judgementOverrideReason: 'Manual security review completed' }),
    }));
    expect(testContainer.operations.start).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'convert_proposal_and_publish',
      proposalId: 'proposal-1',
      payload: expect.objectContaining({ comment: 'Approved for publication', judgementOverrideAllowed: true }),
    }));
  });

  it('preflights the combined publication workflow before creating an operation', async () => {
    const { app, testContainer } = await appFor(['admin']);
    const getDetail = vi.mocked(testContainer.proposalRead.getDetail);

    getDetail.mockResolvedValueOnce(null);
    const missing = await app.inject({ method: 'POST', url: '/admin/proposals/prop-idem-missing/finalize-and-publish', payload: {} });

    getDetail.mockResolvedValueOnce({ id: 'proposal-1', status: 'in_upload' } as never);
    const notReady = await app.inject({ method: 'POST', url: '/admin/proposals/proposal-1/finalize-and-publish', payload: {} });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json()).toMatchObject({ code: 'CONFLICT' });
    expect(testContainer.operations.start).not.toHaveBeenCalled();
  });
});
