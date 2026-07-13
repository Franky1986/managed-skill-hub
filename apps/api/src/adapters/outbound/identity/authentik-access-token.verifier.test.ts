import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationPolicy } from '../../../application/security/authorization-policy';
import { PrincipalProjectionService } from '../../../application/security/principal-projection.service';
import { AppConfig } from '../../../infrastructure/config';
import { SqliteIdentityPersistence } from './sqlite-identity.persistence';
import { AuthentikAccessTokenVerifier } from './authentik-access-token.verifier';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    oidcAgentIssuer: 'https://auth.example.test/application/o/agent/',
    oidcAgentClientId: 'managedskillhub-agent-device',
    oidcAgentBaseScopes: ['openid', 'profile', 'email'],
    oidcDiscoveryScope: 'managedskillhub:discovery',
    oidcPublicReadScope: 'managedskillhub:skills:read',
    oidcProposalScope: 'managedskillhub:proposals',
    oidcProposalAccess: 'all_authenticated_users',
    oidcProposalGroups: ['managedskillhub-submitters'],
    oidcPublicReadAccess: 'all_authenticated_users',
    oidcPublicReadGroups: ['managedskillhub-readers'],
    oidcAdminSubjects: [],
    oidcAdminGroups: ['managedskillhub-admins'],
    oidcReviewerGroups: ['managedskillhub-reviewers'],
    oidcPublisherGroups: ['managedskillhub-publishers'],
    oidcMaxTokenBytes: 16_384,
    oidcMaxGroups: 100,
    oidcHumanClaim: 'managedskillhub_human',
    oidcClockToleranceSeconds: 30,
    oidcHttpTimeoutMs: 5000,
    oidcJwksCacheTtlSeconds: 3600,
    ...overrides,
  } as AppConfig;
}

describe('AuthentikAccessTokenVerifier', () => {
  let directory: string;
  let persistence: SqliteIdentityPersistence;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-token-'));
    persistence = new SqliteIdentityPersistence(path.join(directory, 'catalog.db'));
  });

  afterEach(async () => {
    persistence.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('validates signature, issuer, audience, scope, human claim, and projects a stable principal', async () => {
    const appConfig = config();
    const { verifier, privateKey } = await buildVerifier(appConfig, persistence);
    const token = await signToken(privateKey, appConfig, {
      scope: 'openid profile managedskillhub:proposals',
      managedskillhub_human: true,
      groups: [],
    });

    const first = await verifier.verifyAccessToken(token, 'proposal');
    const second = await verifier.verifyAccessToken(token, 'proposal');

    expect(first).toMatchObject({
      principalId: expect.any(String),
      kind: 'human',
      externalSubject: 'user-uuid-1',
      clientId: 'managedskillhub-agent-device',
      scheme: 'oidc',
      roles: expect.arrayContaining(['submitter']),
    });
    expect(second.principalId).toBe(first.principalId);
    expect(verifier.metadata()).toMatchObject({
      deviceAuthorizationEndpoint: 'https://auth.example.test/application/o/device/',
      tokenEndpoint: 'https://auth.example.test/application/o/token/',
      clientId: 'managedskillhub-agent-device',
    });
  });

  it.each([
    ['wrong issuer', { issuer: 'https://evil.example/' }],
    ['wrong audience', { audience: 'another-client' }],
    ['missing area scope', { scope: 'openid profile' }],
    ['wrong authorized party', { azp: 'another-client' }],
    ['missing human delegation', { managedskillhub_human: false }],
  ])('rejects %s', async (_label, overrides) => {
    const appConfig = config();
    const { verifier, privateKey } = await buildVerifier(appConfig, persistence);
    const token = await signToken(privateKey, appConfig, {
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
      ...overrides,
    });

    await expect(verifier.verifyAccessToken(token, 'proposal')).rejects.toThrow(
      'OIDC access token is invalid or insufficient'
    );
  });

  it('rejects expired, oversized, excessive-group, and symmetric tokens', async () => {
    const appConfig = config({ oidcMaxTokenBytes: 1200, oidcMaxGroups: 1 });
    const { verifier, privateKey } = await buildVerifier(appConfig, persistence);
    const expired = await signToken(privateKey, appConfig, {
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
      expiration: Math.floor(Date.now() / 1000) - 120,
    });
    const excessiveGroups = await signToken(privateKey, appConfig, {
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
      groups: ['one', 'two'],
    });
    const oversized = `${expired}.${'x'.repeat(2000)}`;
    const symmetric = await new SignJWT({
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setIssuer(appConfig.oidcAgentIssuer!)
      .setAudience(appConfig.oidcAgentClientId!)
      .setSubject('user-uuid-1')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-secret-that-is-long-enough-for-tests'));

    await expect(verifier.verifyAccessToken(expired, 'proposal')).rejects.toThrow();
    await expect(verifier.verifyAccessToken(excessiveGroups, 'proposal')).rejects.toThrow();
    await expect(verifier.verifyAccessToken(oversized, 'proposal')).rejects.toThrow();
    await expect(verifier.verifyAccessToken(symmetric, 'proposal')).rejects.toThrow();
  });

  it('requires group policy membership when configured', async () => {
    const appConfig = config({ oidcProposalAccess: 'required_groups' });
    const { verifier, privateKey } = await buildVerifier(appConfig, persistence);
    const withoutGroup = await signToken(privateKey, appConfig, {
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
      groups: [],
    });
    const withGroup = await signToken(privateKey, appConfig, {
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
      groups: ['managedskillhub-submitters'],
    });

    await expect(verifier.verifyAccessToken(withoutGroup, 'proposal')).rejects.toThrow();
    await expect(verifier.verifyAccessToken(withGroup, 'proposal')).resolves.toMatchObject({ kind: 'human' });
  });
});

async function buildVerifier(appConfig: AppConfig, persistence: SqliteIdentityPersistence) {
  const jose = await import('jose');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'key-1';
  publicJwk.alg = 'RS256';
  const local = jose.createLocalJWKSet({ keys: [publicJwk] });
  const remote = Object.assign(
    async (...args: Parameters<typeof local>) => local(...args),
    {
    reload: vi.fn().mockResolvedValue(undefined),
    coolingDown: false,
    fresh: true,
    reloading: false,
    jwks: () => ({ keys: [publicJwk] }),
    }
  );
  const joseAdapter = {
    ...jose,
    createRemoteJWKSet: vi.fn().mockReturnValue(remote),
  } as unknown as typeof import('jose');
  const oidc = {
    discovery: vi.fn().mockResolvedValue({
      serverMetadata: () => ({
        issuer: appConfig.oidcAgentIssuer,
        authorization_endpoint: 'https://auth.example.test/application/o/authorize/',
        device_authorization_endpoint: 'https://auth.example.test/application/o/device/',
        token_endpoint: 'https://auth.example.test/application/o/token/',
        jwks_uri: 'https://auth.example.test/application/o/agent/jwks/',
      }),
    }),
    None: vi.fn(),
    customFetch: Symbol('customFetch'),
  } as unknown as typeof import('openid-client');
  const policy = new AuthorizationPolicy(appConfig);
  const projection = new PrincipalProjectionService(persistence, policy, appConfig);
  const verifier = new AuthentikAccessTokenVerifier(
    appConfig,
    projection,
    policy,
    async () => oidc,
    async () => joseAdapter
  );
  await verifier.initialize();
  return { verifier, privateKey };
}

async function signToken(
  privateKey: CryptoKey,
  appConfig: AppConfig,
  overrides: Record<string, unknown>
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const issuer = typeof overrides.issuer === 'string' ? overrides.issuer : appConfig.oidcAgentIssuer!;
  const audience = typeof overrides.audience === 'string' ? overrides.audience : appConfig.oidcAgentClientId!;
  const expiration = typeof overrides.expiration === 'number' ? overrides.expiration : now + 300;
  const payload = { ...overrides };
  delete payload.issuer;
  delete payload.audience;
  delete payload.expiration;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1', typ: 'at+jwt' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('user-uuid-1')
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .setExpirationTime(expiration)
    .sign(privateKey);
}
