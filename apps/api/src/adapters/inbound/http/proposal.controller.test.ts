import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { describe, expect, it, vi } from 'vitest';
import { createProposalRateLimiter, registerProposalRoutes } from './proposal.controller';
import { AgentApiAuth } from './agent-api-auth';
import { registerApiErrorHandler } from './error-response';
import type { Container } from '../../../infrastructure/container';
import type { AccessTokenVerifierPort, AgentTokenArea } from '../../../application/ports/outbound/access-token-verifier.port';
import type { AuthenticatedPrincipal } from '../../../application/security/authenticated-principal';
import { ForbiddenError } from '../../../domain/errors';

async function buildApp(container: Container, trustProxy: boolean | string[] = false): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy });
  await app.register(multipart);
  registerProposalRoutes(app, container);
  registerApiErrorHandler(app);
  return app;
}

describe('registerProposalRoutes', () => {
  it('does not forward an arbitrary proposalId from the public duplicate preflight', async () => {
    const execute = vi.fn().mockResolvedValue({
      submittedContentDigest: null,
      exactDuplicateProposalId: null,
      exactDuplicateSkillId: null,
      similarMatches: [],
      skillIdCollision: { exists: false, existingSkillId: null, note: '' },
      resolutionOptions: [],
      note: '',
    });
    const container = {
      config: { proposalAuthMode: 'none' },
      proposalDuplicateCheck: { execute },
    } as unknown as Container;
    const app = await buildApp(container);

    const response = await app.inject({
      method: 'POST',
      url: '/proposals/check-duplicate',
      payload: {
        proposalId: '../../private-proposal',
        title: 'Public metadata',
        description: 'Fingerprint-only preflight',
        category: 'tooling',
        entrypoint: 'SKILL.md',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('guards proposal endpoints and derives actor from bearer auth', async () => {
    const submitProposal = vi.fn().mockResolvedValue({ id: 'prop-1' });
    const container = {
      config: {
        proposalAuthMode: 'bearer',
        proposalBearerToken: 'proposal-secret',
        proposalBearerActor: 'trusted-agent',
      },
      proposalCommand: {
        submitProposal,
      },
    } as unknown as Container;
    const app = Fastify({ logger: false });
    registerProposalRoutes(app, container, new AgentApiAuth(container.config));
    registerApiErrorHandler(app);

    const missing = await app.inject({ method: 'POST', url: '/proposals', payload: {} });
    const valid = await app.inject({
      method: 'POST',
      url: '/proposals',
      headers: { authorization: 'Bearer proposal-secret', 'x-actor': 'spoofed-agent' },
      payload: {
        title: 'Skill',
        description: 'Description',
        category: 'automation',
      },
    });

    expect(missing.statusCode).toBe(401);
    expect(valid.statusCode).toBe(201);
    expect(submitProposal).toHaveBeenCalledWith(expect.any(Object), 'trusted-agent');
  });

  it('maps stable OIDC ownership while allowing another accepted human to read status only', async () => {
    const updateProposalMetadata = vi.fn().mockImplementation(async (_id, _update, actor) => {
      if (typeof actor === 'string' || actor.principalId !== 'principal-owner') {
        throw new ForbiddenError('Only the owning principal may modify this proposal.');
      }
      return {
        id: 'prop-1',
        status: 'in_upload',
        title: 'Updated Skill',
        description: 'Description',
        category: 'automation',
        tags: [],
        capabilities: [],
        entrypoint: 'SKILL.md',
      };
    });
    const container = {
      config: {
        proposalAuthMode: 'oidc',
        publicApiBaseUrl: 'https://skills.example.test/api',
      },
      proposalRead: {
        getPublicStatus: vi.fn().mockResolvedValue({
          id: 'prop-1',
          title: 'Skill',
          status: 'in_upload',
          uploadFinalized: false,
        }),
      },
      proposalCommand: { updateProposalMetadata },
    } as unknown as Container;
    const auth = new AgentApiAuth(container.config, oidcVerifier({
      'owner-token': oidcPrincipal('principal-owner', 'managedskillhub-agent-device'),
      'reader-token': oidcPrincipal('principal-reader', 'managedskillhub-agent-device'),
      'owner-new-session-token': oidcPrincipal('principal-owner', 'managedskillhub-agent-device'),
    }));
    const app = Fastify({ logger: false });
    registerProposalRoutes(app, container, auth);
    registerApiErrorHandler(app);

    const statusAsOtherHuman = await app.inject({
      method: 'GET',
      url: '/proposals/prop-1/status',
      headers: { authorization: 'Bearer reader-token' },
    });
    const mutationAsOtherHuman = await app.inject({
      method: 'PATCH',
      url: '/proposals/prop-1',
      headers: { authorization: 'Bearer reader-token' },
      payload: { title: 'Blocked update' },
    });
    const mutationFromNewOwnerSession = await app.inject({
      method: 'PATCH',
      url: '/proposals/prop-1',
      headers: { authorization: 'Bearer owner-new-session-token' },
      payload: { title: 'Updated Skill' },
    });

    expect(statusAsOtherHuman.statusCode).toBe(200);
    expect(statusAsOtherHuman.payload).not.toContain('principal-owner');
    expect(statusAsOtherHuman.payload).not.toContain('submittedBy');
    expect(mutationAsOtherHuman.statusCode).toBe(403);
    expect(mutationFromNewOwnerSession.statusCode).toBe(200);
    expect(updateProposalMetadata).toHaveBeenLastCalledWith(
      'prop-1',
      expect.objectContaining({ title: 'Updated Skill' }),
      {
        label: 'User principal-owner',
        principalId: 'principal-owner',
        clientId: 'managedskillhub-agent-device',
      }
    );
  });

  it('rate limits refreshed OIDC tokens by stable principal and client identity', async () => {
    const getNotice = vi.fn().mockResolvedValue({ hasNewProposals: false, totalPending: 0, counts: { in_upload: 0, submitted: 0, judged: 0, converted: 0 } });
    const container = {
      config: {
        proposalAuthMode: 'oidc',
        publicApiBaseUrl: 'https://skills.example.test/api',
        proposalRateLimitWindowMs: 60_000,
        proposalRateLimitMaxRequests: 1,
        proposalRateLimitMaxBuckets: 10,
      },
      proposalRead: { getNotice },
    } as unknown as Container;
    const principal = oidcPrincipal('principal-owner', 'managedskillhub-agent-device');
    const app = Fastify({ logger: false });
    registerProposalRoutes(
      app,
      container,
      new AgentApiAuth(container.config, oidcVerifier({ 'token-one': principal, 'token-two': principal }))
    );
    registerApiErrorHandler(app);

    const first = await app.inject({
      method: 'GET',
      url: '/proposals/notice',
      headers: { authorization: 'Bearer token-one' },
    });
    const refreshedToken = await app.inject({
      method: 'GET',
      url: '/proposals/notice',
      headers: { authorization: 'Bearer token-two' },
    });

    expect(first.statusCode).toBe(200);
    expect(refreshedToken.statusCode).toBe(429);
    expect(getNotice).toHaveBeenCalledTimes(1);
  });

  it('uses the explicit multipart path field for relative proposal file paths', async () => {
    const attachFile = vi.fn().mockResolvedValue({
      id: 'prop-1',
      files: [
        {
          id: 'scripts/build-benchmark-ppt.py',
          path: 'scripts/build-benchmark-ppt.py',
          mimeType: 'text/x-python',
          sizeBytes: 14,
          sha256: 'sha',
        },
      ],
    });

    const container = {
      config: {
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
      },
      proposalCommand: {
        attachFile,
      },
    } as unknown as Container;

    const app = await buildApp(container);
    const boundary = '----managed-skill-hub-boundary';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="path"',
      '',
      'scripts/build-benchmark-ppt.py',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="build-benchmark-ppt.py"',
      'Content-Type: text/x-python',
      '',
      'print("hello")',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/proposals/prop-1/files',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(attachFile).toHaveBeenCalledWith(
      'prop-1',
      expect.objectContaining({
        path: 'scripts/build-benchmark-ppt.py',
        mimeType: 'text/x-python',
      }),
      'agent'
    );
  });

  it('rate limits proposal endpoints per request actor or ip', async () => {
    const submitProposal = vi.fn().mockResolvedValue({ id: 'prop-1' });
    const container = {
      config: {
        proposalRateLimitWindowMs: 60_000,
        proposalRateLimitMaxRequests: 1,
      },
      proposalCommand: {
        submitProposal,
      },
    } as unknown as Container;

    const app = await buildApp(container);
    const payload = {
      title: 'Skill',
      description: 'Description',
      category: 'automation',
    };

    const first = await app.inject({ method: 'POST', url: '/proposals', payload });
    const second = await app.inject({ method: 'POST', url: '/proposals', payload });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
    expect(JSON.parse(second.payload)).toMatchObject({
      code: 'PROPOSAL_RATE_LIMIT_EXCEEDED',
      details: {
        windowMs: 60_000,
        maxRequests: 1,
      },
    });
    expect(submitProposal).toHaveBeenCalledTimes(1);
  });

  it('uses forwarded client IPs only when the connecting proxy is trusted', async () => {
    const submitProposal = vi.fn().mockResolvedValue({ id: 'prop-1' });
    const container = {
      config: {
        proposalRateLimitWindowMs: 60_000,
        proposalRateLimitMaxRequests: 1,
        proposalRateLimitMaxBuckets: 10,
      },
      proposalCommand: {
        submitProposal,
      },
    } as unknown as Container;
    const app = await buildApp(container, ['127.0.0.1']);
    const payload = {
      title: 'Skill',
      description: 'Description',
      category: 'automation',
    };

    const firstClient = await app.inject({
      method: 'POST',
      url: '/proposals',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.10' },
      payload,
    });
    const secondClient = await app.inject({
      method: 'POST',
      url: '/proposals',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.11' },
      payload,
    });
    const firstClientAgain = await app.inject({
      method: 'POST',
      url: '/proposals',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.10' },
      payload,
    });

    expect(firstClient.statusCode).toBe(201);
    expect(secondClient.statusCode).toBe(201);
    expect(firstClientAgain.statusCode).toBe(429);
  });

  it('bounds identity buckets without evicting active rate-limit state', async () => {
    const submitProposal = vi.fn().mockResolvedValue({ id: 'prop-1' });
    const container = {
      config: {
        proposalRateLimitWindowMs: 60_000,
        proposalRateLimitMaxRequests: 1,
        proposalRateLimitMaxBuckets: 2,
      },
      proposalCommand: {
        submitProposal,
      },
    } as unknown as Container;
    const app = await buildApp(container);
    const payload = {
      title: 'Skill',
      description: 'Description',
      category: 'automation',
    };

    const responses = [];
    for (const remoteAddress of ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.1']) {
      responses.push(await app.inject({
        method: 'POST',
        url: '/proposals',
        remoteAddress,
        payload,
      }));
    }

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201, 429, 429]);
    expect(JSON.parse(responses[2]?.payload ?? '{}').code).toBe('PROPOSAL_RATE_LIMIT_CAPACITY_EXCEEDED');
    expect(JSON.parse(responses[3]?.payload ?? '{}').code).toBe('PROPOSAL_RATE_LIMIT_EXCEEDED');
    expect(submitProposal).toHaveBeenCalledTimes(2);
  });

  it('shares one rate-limit budget between root and prefixed proposal routes', async () => {
    const submitProposal = vi.fn().mockResolvedValue({ id: 'prop-1' });
    const container = {
      config: {
        proposalRateLimitWindowMs: 60_000,
        proposalRateLimitMaxRequests: 1,
        proposalRateLimitMaxBuckets: 10,
      },
      proposalCommand: { submitProposal },
    } as unknown as Container;
    const app = Fastify({ logger: false });
    const limiter = createProposalRateLimiter(container.config);
    await app.register(async (apiApp) => {
      registerProposalRoutes(apiApp, container, new AgentApiAuth(container.config), limiter);
    }, { prefix: '/api' });
    registerProposalRoutes(app, container, new AgentApiAuth(container.config), limiter);
    registerApiErrorHandler(app);
    const payload = { title: 'Skill', description: 'Description', category: 'automation' };

    const root = await app.inject({ method: 'POST', url: '/proposals', payload });
    const prefixed = await app.inject({ method: 'POST', url: '/api/proposals', payload });

    expect(root.statusCode).toBe(201);
    expect(prefixed.statusCode).toBe(429);
    expect(submitProposal).toHaveBeenCalledTimes(1);
  });

  it('updates proposal metadata while upload is still open', async () => {
    const updateProposalMetadata = vi.fn().mockResolvedValue({
      id: 'prop-1',
      status: 'in_upload',
      title: 'Corrected Skill',
      description: 'Corrected description',
      category: 'automation',
      tags: ['corrected'],
      capabilities: ['benchmark'],
      entrypoint: 'SKILL.md',
    });

    const container = {
      config: {},
      proposalCommand: {
        updateProposalMetadata,
      },
    } as unknown as Container;

    const app = await buildApp(container);
    const response = await app.inject({
      method: 'PATCH',
      url: '/proposals/prop-1',
      payload: {
        title: 'Corrected Skill',
        description: 'Corrected description',
        category: 'automation',
        tags: ['corrected'],
        capabilities: ['benchmark'],
        entrypoint: 'SKILL.md',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(updateProposalMetadata).toHaveBeenCalledWith(
      'prop-1',
      expect.objectContaining({
        title: 'Corrected Skill',
        entrypoint: 'SKILL.md',
      }),
      'agent'
    );
    expect(JSON.parse(response.payload)).toMatchObject({
      id: 'prop-1',
      status: 'in_upload',
      title: 'Corrected Skill',
    });
  });

  it('validates an open proposal upload without finalizing it', async () => {
    const validateUpload = vi.fn().mockResolvedValue({
      proposalId: 'prop-1',
      status: 'in_upload',
      valid: false,
      fileCount: 2,
      checkedTextFileCount: 1,
      findings: [{
        kind: 'missing_package_reference',
        severity: 'error',
        blocksFinalize: true,
        message: 'Missing package reference "missing.json".',
        file: 'SKILL.md',
        line: 1,
        candidate: 'missing.json',
        suggestedReplacement: null,
      }],
    });

    const container = {
      config: {},
      proposalCommand: {
        validateUpload,
      },
    } as unknown as Container;

    const app = await buildApp(container);
    const response = await app.inject({
      method: 'POST',
      url: '/proposals/prop-1/validate-upload',
    });

    expect(response.statusCode).toBe(200);
    expect(validateUpload).toHaveBeenCalledWith('prop-1', 'agent');
    expect(JSON.parse(response.payload)).toMatchObject({
      proposalId: 'prop-1',
      status: 'in_upload',
      valid: false,
      findings: [expect.objectContaining({
        kind: 'missing_package_reference',
        candidate: 'missing.json',
      })],
    });
  });

  it('deletes an open proposal upload through the proposal API', async () => {
    const deleteProposal = vi.fn().mockResolvedValue(undefined);

    const container = {
      config: {},
      proposalCommand: {
        deleteProposal,
      },
    } as unknown as Container;

    const app = await buildApp(container);
    const response = await app.inject({
      method: 'DELETE',
      url: '/proposals/prop-1',
    });

    expect(response.statusCode).toBe(204);
    expect(deleteProposal).toHaveBeenCalledWith('prop-1', 'agent');
  });

  it('falls back to the uploaded filename when no explicit path field is present', async () => {
    const attachFile = vi.fn().mockResolvedValue({
      id: 'prop-1',
      files: [],
    });

    const container = {
      config: {
        proposalMaxFileSizeBytes: 10 * 1024 * 1024,
      },
      proposalCommand: {
        attachFile,
      },
    } as unknown as Container;

    const app = await buildApp(container);
    const boundary = '----managed-skill-hub-boundary';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="SKILL.md"',
      'Content-Type: text/markdown',
      '',
      '# Skill',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/proposals/prop-1/files',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(attachFile).toHaveBeenCalledWith(
      'prop-1',
      expect.objectContaining({
        path: 'SKILL.md',
        mimeType: 'text/markdown',
      }),
      'agent'
    );
  });
});

function oidcPrincipal(principalId: string, clientId: string): AuthenticatedPrincipal {
  return {
    principalId,
    kind: 'human',
    externalSubject: `${principalId}-subject`,
    issuer: 'https://auth.example.test/application/o/agent/',
    clientId,
    displayName: `User ${principalId}`,
    email: null,
    groups: [],
    roles: ['submitter'],
    scheme: 'oidc',
  };
}

function oidcVerifier(principals: Record<string, AuthenticatedPrincipal>): AccessTokenVerifierPort {
  return {
    initialize: async () => undefined,
    metadata: () => null,
    verifyAccessToken: async (token: string, _area: AgentTokenArea) => {
      const principal = principals[token];
      if (!principal) throw new Error('invalid token');
      return principal;
    },
  };
}
