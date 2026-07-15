import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { registerAgentSessionRoutes } from './agent-session.controller';
import { registerApiErrorHandler } from './error-response';
import { AgentApiAuth } from './agent-api-auth';
import { SimpleAdminAuth } from './simple-admin-auth';
import { registerAdminAuthRoutes } from './admin-auth.controller';
import { ValidateAgentSessionUseCase } from '../../../application/usecases/agent-session/validate-agent-session.usecase';
import {
  AgentSession,
  AgentSessionRepositoryPort,
} from '../../../application/ports/outbound/agent-session.port';

function buildConfig(overrides: Record<string, unknown> = {}) {
  return {
    registryId: 'local',
    registryName: 'ManagedSkillHub Local',
    publicApiBaseUrl: 'http://localhost:3040',
    corsAllowedOrigins: [],
    adminCsrfOriginCheck: false,
    adminUiBasePath: '/frontend/admin',
    apiHost: '0.0.0.0',
    apiPort: 3040,
    apiTrustedProxies: [],
    adminAuthMode: 'simple' as const,
    adminUser: 'admin',
    adminPassword: 'admin',
    adminPasswordHash: '',
    jwtSecret: 'secret',
    sessionTtlSeconds: 86400,
    agentSessionEnabled: true,
    agentSessionTtlSeconds: 3 * 3600,
    agentSessionCodeLength: 8,
    agentSessionCodeCharset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    agentSessionMaxActive: null,
    agentSessionAuthRateLimitWindowMs: 60_000,
    agentSessionAuthRateLimitMaxFailures: 30,
    agentSessionAuthRateLimitMaxBuckets: 10_000,
    publicReadAuthMode: 'bearer' as const,
    publicReadBearerToken: 'read-secret',
    publicReadBearerActor: 'agent-read-token',
    proposalAuthMode: 'bearer' as const,
    proposalBearerToken: 'proposal-secret',
    proposalBearerActor: 'agent-proposal-token',
    discoveryAuthMode: 'bearer' as const,
    discoveryBearerToken: 'discovery-secret',
    discoveryBearerActor: 'agent-discovery-token',
    ...overrides,
  };
}

class InMemoryAgentSessionRepository implements AgentSessionRepositoryPort {
  private sessions: AgentSession[] = [];

  async create(session: AgentSession): Promise<void> {
    this.sessions.push(session);
  }

  async findByCode(code: string): Promise<AgentSession | null> {
    return this.sessions.find((s) => s.code === code) ?? null;
  }

  async updateLastUsed(code: string, lastUsedAt: Date, lastUsedIp: string | null): Promise<void> {
    const session = this.sessions.find((s) => s.code === code);
    if (session) {
      session.lastUsedAt = lastUsedAt;
      session.lastUsedIp = lastUsedIp;
    }
  }

  async list(options?: {
    includeExpired?: boolean;
    includeRevoked?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<AgentSession[]> {
    let result = [...this.sessions];
    if (!options?.includeExpired) {
      result = result.filter((s) => s.expiresAt.getTime() > Date.now());
    }
    if (!options?.includeRevoked) {
      result = result.filter((s) => s.revokedAt === null);
    }
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    return result.slice(offset, offset + limit);
  }

  async revoke(sessionId: string, revokedAt: Date): Promise<boolean> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session || session.revokedAt !== null) {
      return false;
    }
    session.revokedAt = revokedAt;
    return true;
  }

  async countActiveByIp(ip: string): Promise<number> {
    return this.sessions.filter(
      (s) => s.createdByIp === ip && s.revokedAt === null && s.expiresAt.getTime() > Date.now()
    ).length;
  }
}

describe('AgentSessionController', () => {
  let repo: InMemoryAgentSessionRepository;

  beforeEach(() => {
    repo = new InMemoryAgentSessionRepository();
  });

  afterEach(() => {
    // no-op
  });

  async function buildApp(config: ReturnType<typeof buildConfig>) {
    const app = Fastify({ logger: false });
    await app.register(cookie);
    registerApiErrorHandler(app);
    const validateUseCase = config.agentSessionEnabled
      ? new ValidateAgentSessionUseCase(repo)
      : undefined;
    const agentAuth = new AgentApiAuth(
      config as unknown as import('../../../infrastructure/config').AppConfig,
      undefined,
      validateUseCase
    );
    const adminAuth = new SimpleAdminAuth(config as unknown as import('../../../infrastructure/config').AppConfig);
    registerAdminAuthRoutes(app, adminAuth);
    const container = {
      config: config as unknown as import('../../../infrastructure/container').Container['config'],
      agentSessionRepository: repo,
    } as import('../../../infrastructure/container').Container;
    registerAgentSessionRoutes(app, container, agentAuth, adminAuth);
    app.get('/session-context', { preHandler: agentAuth.guard('proposal') }, async (request) => (
      (request as typeof request & { agentAuth: unknown }).agentAuth
    ));
    return app;
  }

  it('creates an agent session with a valid proposal bearer token', async () => {
    const app = await buildApp(buildConfig());
    const response = await app.inject({
      method: 'POST',
      url: '/agent-sessions',
      headers: { 'x-agent-proposal-token': 'proposal-secret' },
      payload: { areas: ['proposal'] },
    });
    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.payload);
    expect(payload.code).toHaveLength(8);
    expect(payload.areas).toEqual(['proposal']);
    expect(payload.expiresAt).toBeDefined();
  });

  it('creates an agent session covering multiple areas when all tokens are valid', async () => {
    const app = await buildApp(buildConfig());
    const response = await app.inject({
      method: 'POST',
      url: '/agent-sessions',
      headers: {
        'x-agent-read-token': 'read-secret',
        'x-agent-proposal-token': 'proposal-secret',
      },
      payload: { areas: ['public-read', 'proposal'] },
    });
    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.payload);
    expect(payload.areas).toEqual(['public-read', 'proposal']);
  });

  it('rejects session creation without a bearer token', async () => {
    const app = await buildApp(buildConfig());
    const response = await app.inject({
      method: 'POST',
      url: '/agent-sessions',
      payload: { areas: ['proposal'] },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects session creation with a wrong bearer token', async () => {
    const app = await buildApp(buildConfig());
    const response = await app.inject({
      method: 'POST',
      url: '/agent-sessions',
      headers: { 'x-agent-proposal-token': 'wrong-secret' },
      payload: { areas: ['proposal'] },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects session creation when one requested area token is missing', async () => {
    const app = await buildApp(buildConfig());
    const response = await app.inject({
      method: 'POST',
      url: '/agent-sessions',
      headers: { 'x-agent-read-token': 'read-secret' },
      payload: { areas: ['public-read', 'proposal'] },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects session creation for an area that is not bearer-protected', async () => {
    const app = await buildApp(buildConfig({ discoveryAuthMode: 'none' as const, discoveryBearerToken: null }));
    const response = await app.inject({
      method: 'POST',
      url: '/agent-sessions',
      headers: { 'x-agent-discovery-token': 'discovery-secret' },
      payload: { areas: ['discovery'] },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects session creation for an invalid area name', async () => {
    const app = await buildApp(buildConfig());
    const response = await app.inject({
      method: 'POST',
      url: '/agent-sessions',
      headers: { 'x-agent-proposal-token': 'proposal-secret' },
      payload: { areas: ['admin'] },
    });
    expect(response.statusCode).toBe(422);
  });

  it('uses a non-secret session ID for authenticated actor and principal attribution', async () => {
    const app = await buildApp(buildConfig());
    const createResponse = await app.inject({
      method: 'POST',
      url: '/agent-sessions',
      headers: { 'x-agent-proposal-token': 'proposal-secret' },
      payload: { areas: ['proposal'] },
    });
    const { code } = JSON.parse(createResponse.payload);

    const validate = await app.inject({
      method: 'GET',
      url: '/session-context',
      headers: { authorization: `AgentSession ${code}` },
    });
    expect(validate.statusCode).toBe(200);
    const context = JSON.parse(validate.payload);
    expect(context.actor).toMatch(/^agent-session:[0-9a-f-]{36}$/);
    expect(context.actor).not.toContain(code);
    expect(context.principal).toMatchObject({
      principalId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      displayName: 'Agent session',
    });
    expect(context.principal.principalId).not.toContain(code);
  });

  it('fails closed after repeated invalid agent-session codes from one origin', async () => {
    const app = await buildApp(buildConfig({ agentSessionAuthRateLimitMaxFailures: 2 }));
    const createResponse = await app.inject({
      method: 'POST',
      url: '/agent-sessions',
      headers: { 'x-agent-proposal-token': 'proposal-secret' },
      payload: { areas: ['proposal'] },
    });
    const { code } = JSON.parse(createResponse.payload);

    for (const invalidCode of ['INVALID1', 'INVALID2']) {
      const invalid = await app.inject({
        method: 'GET',
        url: '/session-context',
        headers: { authorization: `AgentSession ${invalidCode}` },
      });
      expect(invalid.statusCode).toBe(401);
    }

    const blocked = await app.inject({
      method: 'GET',
      url: '/session-context',
      headers: { authorization: `AgentSession ${code}` },
    });
    expect(blocked.statusCode).toBe(401);
  });

  it('allows admin to list and revoke sessions', async () => {
    const app = await buildApp(buildConfig());
    const createResponse = await app.inject({
      method: 'POST',
      url: '/agent-sessions',
      headers: { 'x-agent-proposal-token': 'proposal-secret' },
      payload: { areas: ['proposal'] },
    });
    const { code } = JSON.parse(createResponse.payload);

    // Admin login
    const login = await app.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { username: 'admin', password: 'admin' },
    });
    expect(login.statusCode).toBe(200);
    const cookies = login.headers['set-cookie'] as string | string[];
    const cookieHeader = Array.isArray(cookies) ? cookies[0] : cookies;

    const list = await app.inject({
      method: 'GET',
      url: '/admin/agent-sessions',
      headers: { cookie: cookieHeader },
    });
    expect(list.statusCode).toBe(200);
    const listPayload = JSON.parse(list.payload);
    expect(listPayload.sessions).toHaveLength(1);
    expect(listPayload.sessions[0].code).toBe(code);
    expect(listPayload.sessions[0].id).toMatch(/^[0-9a-f-]{36}$/);

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/admin/agent-sessions/${listPayload.sessions[0].id}`,
      headers: { cookie: cookieHeader },
    });
    expect(revoke.statusCode).toBe(204);

    const listAfter = await app.inject({
      method: 'GET',
      url: '/admin/agent-sessions',
      headers: { cookie: cookieHeader },
    });
    expect(JSON.parse(listAfter.payload).sessions).toHaveLength(0);
  });

  it('returns configured bearer token values to an admin', async () => {
    const app = await buildApp(buildConfig());
    const login = await app.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { username: 'admin', password: 'admin' },
    });
    expect(login.statusCode).toBe(200);
    const cookies = login.headers['set-cookie'] as string | string[];
    const cookieHeader = Array.isArray(cookies) ? cookies[0] : cookies;

    const response = await app.inject({
      method: 'GET',
      url: '/admin/agent-auth-config',
      headers: { cookie: cookieHeader },
    });
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.tokens).toEqual([
      { area: 'discovery', value: 'discovery-secret' },
      { area: 'public-read', value: 'read-secret' },
      { area: 'proposal', value: 'proposal-secret' },
    ]);
  });

  it('rejects agent-auth-config for anonymous users', async () => {
    const app = await buildApp(buildConfig());
    const response = await app.inject({
      method: 'GET',
      url: '/admin/agent-auth-config',
    });
    expect(response.statusCode).toBe(401);
  });

  it('omits non-bearer or empty-token areas from admin auth config', async () => {
    const app = await buildApp(
      buildConfig({
        discoveryAuthMode: 'none' as const,
        discoveryBearerToken: null,
        proposalBearerToken: '',
      })
    );
    const login = await app.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { username: 'admin', password: 'admin' },
    });
    expect(login.statusCode).toBe(200);
    const cookies = login.headers['set-cookie'] as string | string[];
    const cookieHeader = Array.isArray(cookies) ? cookies[0] : cookies;

    const response = await app.inject({
      method: 'GET',
      url: '/admin/agent-auth-config',
      headers: { cookie: cookieHeader },
    });
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.tokens).toEqual([{ area: 'public-read', value: 'read-secret' }]);
  });
});
