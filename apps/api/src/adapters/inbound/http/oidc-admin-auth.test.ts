import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityProviderPort } from '../../../application/ports/outbound/identity-provider.port';
import { AuthorizationPolicy } from '../../../application/security/authorization-policy';
import { PrincipalProjectionService } from '../../../application/security/principal-projection.service';
import { SqliteIdentityPersistence } from '../../outbound/identity/sqlite-identity.persistence';
import { AppConfig } from '../../../infrastructure/config';
import { registerAdminAuthRoutes } from './admin-auth.controller';
import { registerApiErrorHandler } from './error-response';
import { OidcAdminAuth } from './oidc-admin-auth';

function config(): AppConfig {
  return {
    adminAuthMode: 'oidc',
    publicApiBaseUrl: 'https://skills.example.test/api',
    corsAllowedOrigins: ['https://skills.example.test'],
    adminCsrfOriginCheck: true,
    adminUiBasePath: '/admin',
    sessionTtlSeconds: 3600,
    oidcAdminIssuer: 'https://auth.example.test/application/o/admin/',
    oidcAdminClientId: 'managedskillhub-admin-web',
    oidcAdminClientSecret: 'secret',
    oidcAdminRedirectUri: 'https://skills.example.test/api/admin/auth/oidc/callback',
    oidcAdminScopes: ['openid', 'profile', 'email'],
    oidcAdminSubjects: [],
    oidcAdminGroups: ['managedskillhub-admins'],
    oidcReviewerGroups: ['managedskillhub-reviewers'],
    oidcPublisherGroups: ['managedskillhub-publishers'],
    oidcAgentIssuer: 'https://auth.example.test/application/o/agent/',
    oidcProposalAccess: 'all_authenticated_users',
    oidcProposalGroups: ['managedskillhub-submitters'],
    oidcPublicReadAccess: 'all_authenticated_users',
    oidcPublicReadGroups: ['managedskillhub-readers'],
    oidcMaxGroups: 100,
    oidcLoginTransactionTtlSeconds: 600,
  } as AppConfig;
}

describe('OIDC administrator routes', () => {
  let directory: string;
  let persistence: SqliteIdentityPersistence;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-admin-oidc-'));
    persistence = new SqliteIdentityPersistence(path.join(directory, 'catalog.db'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    persistence.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('advertises OIDC, disables password login, and completes a one-time callback', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const appConfig = config();
    const provider = fakeProvider();
    const policy = new AuthorizationPolicy(appConfig);
    const projection = new PrincipalProjectionService(persistence, policy, appConfig);
    const auth = new OidcAdminAuth(appConfig, persistence, persistence);
    const app = Fastify({ logger: false });
    await app.register(cookie);
    registerAdminAuthRoutes(app, auth, {
      config: appConfig,
      provider,
      transactions: persistence,
      principalProjection: projection,
    });
    registerApiErrorHandler(app);

    const methods = await app.inject({ method: 'GET', url: '/admin/auth/methods' });
    const passwordLogin = await app.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { username: 'admin', password: 'password' },
    });
    const start = await app.inject({
      method: 'GET',
      url: '/admin/auth/oidc/start?returnTo=%2Fadmin%2Fproposals',
    });

    expect(methods.json()).toEqual({
      mode: 'oidc',
      loginStartUrl: 'https://skills.example.test/api/admin/auth/oidc/start',
      adminUiBasePath: '/admin',
    });
    expect(passwordLogin.statusCode).toBe(404);
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toBe('https://auth.example.test/authorize?state=state-1');

    const callback = await app.inject({
      method: 'GET',
      url: '/admin/auth/oidc/callback?code=authorization-code&state=state-1',
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/admin/proposals');
    expect(callback.headers['set-cookie']).not.toContain('authorization-code');
    const cookieHeaders = Array.isArray(callback.headers['set-cookie'])
      ? callback.headers['set-cookie'].join('\n')
      : callback.headers['set-cookie'] ?? '';
    expect(cookieHeaders).toContain('HttpOnly');
    expect(cookieHeaders).toContain('Secure');
    expect(cookieHeaders).toContain('SameSite=Strict');
    expect(cookieHeaders).toContain('Path=/');
    const sessionCookie = extractSessionCookie(callback.headers['set-cookie']);

    const session = await app.inject({
      method: 'GET',
      url: '/admin/session',
      headers: { cookie: sessionCookie },
    });
    expect(session.json()).toMatchObject({
      displayName: 'OIDC Admin',
      mode: 'oidc',
      roles: expect.arrayContaining(['admin', 'reviewer', 'publisher']),
    });
    expect(session.payload).not.toContain('access_token');
    expect(session.payload).not.toContain('user-uuid-1');

    const replay = await app.inject({
      method: 'GET',
      url: '/admin/auth/oidc/callback?code=authorization-code&state=state-1',
    });
    expect(replay.statusCode).toBe(401);
    expect(provider.exchangeAdminAuthorization).toHaveBeenCalledTimes(1);

    const logout = await app.inject({
      method: 'POST',
      url: '/admin/logout',
      headers: { cookie: sessionCookie },
    });
    expect(logout.statusCode).toBe(200);
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/admin/session',
      headers: { cookie: sessionCookie },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('rejects external and ambiguous return paths before provider redirect', async () => {
    const appConfig = config();
    const provider = fakeProvider();
    const policy = new AuthorizationPolicy(appConfig);
    const app = Fastify({ logger: false });
    await app.register(cookie);
    registerAdminAuthRoutes(
      app,
      new OidcAdminAuth(appConfig, persistence, persistence),
      {
        config: appConfig,
        provider,
        transactions: persistence,
        principalProjection: new PrincipalProjectionService(persistence, policy, appConfig),
      }
    );
    registerApiErrorHandler(app);

    const external = await app.inject({
      method: 'GET',
      url: '/admin/auth/oidc/start?returnTo=https%3A%2F%2Fevil.example%2Fadmin',
    });
    const protocolRelative = await app.inject({
      method: 'GET',
      url: '/admin/auth/oidc/start?returnTo=%2F%2Fevil.example%2Fadmin',
    });

    expect(external.statusCode).toBe(401);
    expect(protocolRelative.statusCode).toBe(401);
    expect(provider.prepareAdminAuthorization).not.toHaveBeenCalled();
  });
});

function fakeProvider(): IdentityProviderPort & {
  prepareAdminAuthorization: ReturnType<typeof vi.fn>;
  exchangeAdminAuthorization: ReturnType<typeof vi.fn>;
} {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    prepareAdminAuthorization: vi.fn().mockResolvedValue({
      authorizationUrl: 'https://auth.example.test/authorize?state=state-1',
      state: 'state-1',
      nonce: 'nonce-1',
      pkceVerifier: 'pkce-verifier-1',
    }),
    exchangeAdminAuthorization: vi.fn().mockResolvedValue({
      issuer: 'https://auth.example.test/application/o/admin/',
      subject: 'user-uuid-1',
      clientId: 'managedskillhub-admin-web',
      kind: 'human',
      displayName: 'OIDC Admin',
      email: 'admin@example.test',
      groups: ['managedskillhub-admins'],
    }),
  };
}

function extractSessionCookie(value: string | string[] | undefined): string {
  const cookies = Array.isArray(value) ? value : [value ?? ''];
  const session = cookies.find((entry) => entry.startsWith('skill_hub_session='));
  if (!session) {
    throw new Error('Session cookie missing');
  }
  return session.split(';', 1)[0];
}
