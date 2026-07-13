import bcrypt from 'bcryptjs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { describe, expect, it, vi } from 'vitest';
import { type FastifyInstance, type FastifyReply } from 'fastify';
import { SimpleAdminAuth, adminGuard } from './simple-admin-auth';
import { registerAdminAuthRoutes } from './admin-auth.controller';
import { type AppConfig } from '../../../infrastructure/config';
import { UnauthorizedError } from '../../../domain/errors';
import { registerApiErrorHandler } from './error-response';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    dataDir: './data',
    openapiYamlPath: '/nonexistent/openapi.yaml',
    registryId: 'local',
    registryName: 'ManagedSkillHub Local',
    publicApiBaseUrl: 'http://localhost:3040',
    corsAllowedOrigins: ['http://localhost:3041'],
    adminCsrfOriginCheck: true,
    apiHost: '127.0.0.1',
    apiPort: 3040,
    adminUser: 'admin',
    adminPassword: null,
    adminPasswordHash: '',
    jwtSecret: 'test-secret',
    sessionTtlSeconds: 3600,
    judgerProvider: 'noop',
    judgerAdapterPath: null,
    vercelAiSdkModel: null,
    vercelAiSdkTimeoutMs: 30000,
    vercelAiSdkMaxTextChars: 12000,
    vercelAiSdkMaxRetries: 0,
    catalogProvider: 'sqlite',
    searchProvider: 'sqlite',
    contentStorageProvider: 'filesystem',
    mysqlHost: '127.0.0.1',
    mysqlPort: 3306,
    mysqlDatabase: 'managed_skill_hub',
    mysqlUser: 'managed_skill_hub',
    mysqlPassword: '',
    mysqlSslMode: 'preferred',
    mysqlConnectTimeoutMs: 10000,
    mysqlQueryTimeoutMs: 30000,
    proposalMaxFiles: 30,
    proposalMaxFileSizeBytes: 10 * 1024 * 1024,
    proposalDisallowedPaths: [],
    autoPublishOnGreen: false,
    autoPublishExcludedCategories: [],
    autoApproveWithoutJudger: false,
    publicReadAuthMode: 'none',
    publicReadBearerToken: null,
    publicReadBearerActor: 'agent-read-token',
    proposalAuthMode: 'none',
    proposalBearerToken: null,
    proposalBearerActor: 'agent-proposal-token',
    discoveryAuthMode: 'none',
    discoveryBearerToken: null,
    discoveryBearerActor: 'agent-discovery-token',
    ...overrides,
  };
}

function replyStub(): FastifyReply {
  return {
    setCookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as FastifyReply;
}

function requestStub(
  cookie?: string,
  overrides: Partial<Parameters<ReturnType<typeof adminGuard>>[0]> = {}
): Parameters<ReturnType<typeof adminGuard>>[0] {
  return {
    cookies: cookie ? { skill_hub_session: cookie } : {},
    id: 'test-request',
    method: 'GET',
    headers: {
      host: 'localhost:3040',
    },
    protocol: 'http',
    ...overrides,
  } as unknown as Parameters<ReturnType<typeof adminGuard>>[0];
}

async function buildAuthApp(overrides: Partial<AppConfig> = {}): Promise<{ app: FastifyInstance; auth: SimpleAdminAuth }> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const auth = new SimpleAdminAuth(config(overrides));
  registerApiErrorHandler(app);
  registerAdminAuthRoutes(app, auth);
  return { app, auth };
}

describe('SimpleAdminAuth', () => {
  it('accepts direct ADMIN_PASSWORD credentials', async () => {
    const auth = new SimpleAdminAuth(
      config({
        adminPassword: 'admin',
      }),
    );

    const reply = replyStub();
    const success = await auth.login('admin', 'admin', reply);

    expect(success).toBe(true);
    const setCookie = reply.setCookie as ReturnType<typeof vi.fn>;
    const clearCookie = reply.clearCookie as ReturnType<typeof vi.fn>;
    expect(clearCookie).toHaveBeenCalledWith('skill_hub_session', { path: '/' });
    expect(clearCookie).toHaveBeenCalledWith('skill_hub_session', { path: '/admin' });
    expect(setCookie).toHaveBeenCalledWith(
      'skill_hub_session',
      expect.any(String),
      expect.objectContaining({ path: '/' })
    );
  });

  it('falls back to ADMIN_PASSWORD_HASH when no direct password is configured', async () => {
    const auth = new SimpleAdminAuth(
      config({
        adminPasswordHash: await bcrypt.hash('admin', 4),
      }),
    );

    const reply = replyStub();
    const success = await auth.login('admin', 'admin', reply);

    expect(success).toBe(true);
    const setCookie = reply.setCookie as ReturnType<typeof vi.fn>;
    const clearCookie = reply.clearCookie as ReturnType<typeof vi.fn>;
    expect(clearCookie).toHaveBeenCalledWith('skill_hub_session', { path: '/' });
    expect(clearCookie).toHaveBeenCalledWith('skill_hub_session', { path: '/admin' });
    expect(setCookie).toHaveBeenCalledWith(
      'skill_hub_session',
      expect.any(String),
      expect.objectContaining({ path: '/' })
    );
  });

  it('logout clears all configured cookie paths', async () => {
    const auth = new SimpleAdminAuth(config({ adminPassword: 'admin' }));
    const reply = replyStub();

    auth.logout(reply);

    const clearCookie = reply.clearCookie as ReturnType<typeof vi.fn>;
    expect(clearCookie).toHaveBeenCalledTimes(2);
    expect(clearCookie).toHaveBeenCalledWith('skill_hub_session', { path: '/' });
    expect(clearCookie).toHaveBeenCalledWith('skill_hub_session', { path: '/admin' });
  });

  it('rejects invalid passwords', async () => {
    const auth = new SimpleAdminAuth(
      config({
        adminPassword: 'admin',
      }),
    );

    const reply = replyStub();
    const success = await auth.login('admin', 'wrong', reply);

    expect(success).toBe(false);
  });

  it('adminGuard rejects requests without a session cookie', async () => {
    const auth = new SimpleAdminAuth(config());
    const guard = adminGuard(auth);

    await expect(guard(requestStub(), replyStub())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('adminGuard rejects requests with an invalid session cookie', async () => {
    const auth = new SimpleAdminAuth(config());
    const guard = adminGuard(auth);

    await expect(guard(requestStub('invalid-token'), replyStub())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('adminGuard accepts requests with a valid session cookie', async () => {
    const auth = new SimpleAdminAuth(config({ adminPassword: 'admin' }));
    const reply = replyStub();
    await auth.login('admin', 'admin', reply);

    const setCookie = reply.setCookie as ReturnType<typeof vi.fn>;
    const token = setCookie.mock.calls[0][1] as string;

    const guard = adminGuard(auth);
    await expect(guard(requestStub(token), replyStub())).resolves.toBeUndefined();
  });

  it('adminGuard rejects mutating browser requests from unexpected origins', async () => {
    const auth = new SimpleAdminAuth(config({ adminPassword: 'admin' }));
    const reply = replyStub();
    await auth.login('admin', 'admin', reply);
    const setCookie = reply.setCookie as ReturnType<typeof vi.fn>;
    const token = setCookie.mock.calls[0][1] as string;

    const guard = adminGuard(auth);

    await expect(
      guard(
        requestStub(token, {
          method: 'POST',
          headers: { host: 'localhost:3040', origin: 'https://evil.example' },
        }),
        replyStub()
      )
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('adminGuard accepts configured browser origins for mutating requests', async () => {
    const auth = new SimpleAdminAuth(config({ adminPassword: 'admin' }));
    const reply = replyStub();
    await auth.login('admin', 'admin', reply);
    const setCookie = reply.setCookie as ReturnType<typeof vi.fn>;
    const token = setCookie.mock.calls[0][1] as string;

    const guard = adminGuard(auth);

    await expect(
      guard(
        requestStub(token, {
          method: 'POST',
          headers: { host: 'localhost:3040', origin: 'http://localhost:3041' },
        }),
        replyStub()
      )
    ).resolves.toBeUndefined();
  });

  it('GET /admin/session returns 401 without a session cookie', async () => {
    const { app } = await buildAuthApp({ adminPassword: 'admin' });
    const response = await app.inject({ method: 'GET', url: '/admin/session' });

    expect(response.statusCode).toBe(401);
    const payload = JSON.parse(response.payload);
    expect(payload.code).toBe('UNAUTHORIZED');
  });

  it('GET /admin/session returns username with a valid session cookie', async () => {
    const { app, auth } = await buildAuthApp({ adminPassword: 'admin' });
    const reply = replyStub();
    await auth.login('admin', 'admin', reply);

    const setCookie = reply.setCookie as ReturnType<typeof vi.fn>;
    const token = setCookie.mock.calls[0][1] as string;

    const response = await app.inject({
      method: 'GET',
      url: '/admin/session',
      cookies: { skill_hub_session: token },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ username: 'admin' });
  });
});
