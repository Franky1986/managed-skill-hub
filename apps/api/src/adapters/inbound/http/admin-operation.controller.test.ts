import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerAdminOperationRoutes } from './admin-operation.controller';
import { registerApiErrorHandler } from './error-response';
import { AdminAuth, AdminAuthSession } from './admin-auth';
import { Container } from '../../../infrastructure/container';

function auth(): AdminAuth {
  const session: AdminAuthSession = {
    username: 'Reviewer',
    principal: {
      principalId: 'reviewer-1', kind: 'human', externalSubject: 'subject-1', issuer: 'https://auth.example.test',
      clientId: 'admin-web', displayName: 'Reviewer', email: null, groups: [], roles: ['reviewer'], scheme: 'session',
    },
    roles: ['reviewer'], expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  };
  return {
    mode: 'oidc',
    validate: vi.fn(async (request) => request.headers['x-test-session'] === 'reviewer' ? session : null),
    validateMutationOrigin: vi.fn(),
    logout: vi.fn(),
  };
}

function operation() {
  const now = new Date('2026-09-02T08:00:00.000Z');
  return {
    id: 'operation-1', kind: 'rejudge_proposal', state: 'queued', proposalId: 'proposal-1', skillId: null,
    skillVersion: null, filePath: null, requestedBy: 'private-worker', payload: { token: 'must-not-leak' },
    dedupeKey: 'must-not-leak', phase: 'queued', message: 'Queued', completed: 0, total: 0,
    currentTarget: null, errorCode: null, createdAt: now, startedAt: null, finishedAt: null, updatedAt: now,
  };
}

async function appWith(get: (id: string) => unknown) {
  const app = Fastify({ logger: false });
  registerAdminOperationRoutes(app, { operations: { get } } as unknown as Container, auth());
  registerApiErrorHandler(app);
  return app;
}

describe('registerAdminOperationRoutes', () => {
  it('requires a reviewer or publisher session', async () => {
    const app = await appWith(async () => operation());
    const response = await app.inject({ method: 'GET', url: '/admin/operations/operation-1' });
    expect(response.statusCode).toBe(401);
  });

  it('returns a redacted operation projection for an authorized reviewer', async () => {
    const app = await appWith(async () => operation());
    const response = await app.inject({ method: 'GET', url: '/admin/operations/operation-1', headers: { 'x-test-session': 'reviewer' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'operation-1', state: 'queued', proposalId: 'proposal-1' });
    expect(response.json()).not.toHaveProperty('payload');
    expect(response.json()).not.toHaveProperty('requestedBy');
    expect(response.json()).not.toHaveProperty('dedupeKey');
  });

  it('maps a missing operation to 404', async () => {
    const app = await appWith(async () => null);
    const response = await app.inject({ method: 'GET', url: '/admin/operations/missing', headers: { 'x-test-session': 'reviewer' } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});
