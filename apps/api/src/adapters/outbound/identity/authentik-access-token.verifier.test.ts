import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationPolicy } from '../../../application/security/authorization-policy';
import { PrincipalProjectionService } from '../../../application/security/principal-projection.service';
import { AppConfig } from '../../../infrastructure/config';
import { SqliteIdentityPersistence } from './sqlite-identity.persistence';
import {
  AuthentikAccessTokenVerifier,
  OidcSecurityEvent,
  OidcSecurityEventSink,
} from './authentik-access-token.verifier';

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
    oidcAccessTokenValidationMode: 'jwt_profile',
    oidcIntrospectionClientId: null,
    oidcIntrospectionClientSecret: null,
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
    vi.unstubAllGlobals();
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

  it('rejects ID-token-shaped JWTs, future not-before, missing subjects, and unexpected token types', async () => {
    const appConfig = config();
    const { verifier, privateKey } = await buildVerifier(appConfig, persistence);
    const common = {
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
    };
    const idToken = await signToken(privateKey, appConfig, { ...common, tokenType: 'JWT' });
    const future = await signToken(privateKey, appConfig, {
      ...common,
      notBefore: Math.floor(Date.now() / 1000) + 300,
    });
    const missingSubject = await signToken(privateKey, appConfig, { ...common, subject: '' });
    const logoutToken = await signToken(privateKey, appConfig, { ...common, tokenType: 'logout+jwt' });

    await expect(verifier.verifyAccessToken(idToken, 'proposal')).rejects.toThrow();
    await expect(verifier.verifyAccessToken(future, 'proposal')).rejects.toThrow();
    await expect(verifier.verifyAccessToken(missingSubject, 'proposal')).rejects.toThrow();
    await expect(verifier.verifyAccessToken(logoutToken, 'proposal')).rejects.toThrow();
  });

  it('validates real ID-token evidence before proving access-token separation', async () => {
    const appConfig = config();
    const { verifier, privateKey } = await buildVerifier(appConfig, persistence);
    const accessToken = await signToken(privateKey, appConfig, {
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
    });
    const atHash = accessTokenHash(accessToken);
    const idToken = await signToken(privateKey, appConfig, {
      tokenType: 'JWT',
      at_hash: atHash,
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
    });

    await expect(
      verifier.verifyIdTokenEvidence(idToken, accessToken, 'user-uuid-1')
    ).resolves.toEqual({ subject: 'user-uuid-1', accessTokenBinding: 'at_hash' });
    await expect(verifier.verifyAccessToken(idToken, 'proposal')).rejects.toThrow(
      'OIDC access token is invalid or insufficient'
    );

    const withoutAtHash = await signToken(privateKey, appConfig, { tokenType: 'JWT' });
    await expect(
      verifier.verifyIdTokenEvidence(withoutAtHash, accessToken, 'user-uuid-1')
    ).resolves.toEqual({ subject: 'user-uuid-1', accessTokenBinding: 'same_subject' });
  });

  it('rejects malformed, unrelated, and incorrectly bound ID-token evidence', async () => {
    const appConfig = config();
    const { verifier, privateKey } = await buildVerifier(appConfig, persistence);
    const unrelatedKey = await generateKeyPair('RS256');
    const accessToken = await signToken(privateKey, appConfig, {
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
    });
    const wrongAudience = await signToken(privateKey, appConfig, {
      tokenType: 'JWT',
      audience: 'different-client',
    });
    const wrongSubject = await signToken(privateKey, appConfig, {
      tokenType: 'JWT',
      subject: 'different-user',
    });
    const wrongHash = await signToken(privateKey, appConfig, {
      tokenType: 'JWT',
      at_hash: accessTokenHash(`${accessToken}changed`),
    });
    const accessTokenType = await signToken(privateKey, appConfig, { tokenType: 'at+jwt' });
    const wrongSignature = await signToken(unrelatedKey.privateKey, appConfig, { tokenType: 'JWT' });

    await expect(verifier.verifyIdTokenEvidence('garbage', accessToken, 'user-uuid-1')).rejects.toThrow(
      'OIDC ID token evidence is invalid'
    );
    await expect(
      verifier.verifyIdTokenEvidence(wrongAudience, accessToken, 'user-uuid-1')
    ).rejects.toThrow('OIDC ID token evidence is invalid');
    await expect(
      verifier.verifyIdTokenEvidence(wrongSubject, accessToken, 'user-uuid-1')
    ).rejects.toThrow('OIDC ID token evidence is invalid');
    await expect(
      verifier.verifyIdTokenEvidence(wrongHash, accessToken, 'user-uuid-1')
    ).rejects.toThrow('OIDC ID token evidence is invalid');
    await expect(
      verifier.verifyIdTokenEvidence(accessTokenType, accessToken, 'user-uuid-1')
    ).rejects.toThrow('OIDC ID token evidence is invalid');
    await expect(
      verifier.verifyIdTokenEvidence(wrongSignature, accessToken, 'user-uuid-1')
    ).rejects.toThrow('OIDC ID token evidence is invalid');
  });

  it('accepts Authentik JWT access tokens only after authenticated active-token introspection', async () => {
    const appConfig = config({
      oidcAccessTokenValidationMode: 'authentik_introspection',
      oidcIntrospectionClientId: 'managedskillhub-token-checker',
      oidcIntrospectionClientSecret: 'introspection-secret',
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      active: true,
      client_id: appConfig.oidcAgentClientId,
      sub: 'user-uuid-1',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { verifier, privateKey } = await buildVerifier(appConfig, persistence);
    const token = await signToken(privateKey, appConfig, {
      tokenType: 'JWT',
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
    });

    await expect(verifier.verifyAccessToken(token, 'proposal')).resolves.toMatchObject({ kind: 'human' });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://auth.example.test/application/o/introspect/'),
      expect.objectContaining({ method: 'POST', redirect: 'manual' })
    );

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ active: false }), { status: 200 }));
    await expect(verifier.verifyAccessToken(token, 'proposal')).rejects.toThrow(
      'OIDC access token is invalid or insufficient'
    );
  });

  it('reloads JWKS once for a rotated signing key and fails closed when refresh is unavailable', async () => {
    const appConfig = config();
    const jose = await import('jose');
    const first = await generateKeyPair('RS256');
    const rotated = await generateKeyPair('RS256');
    const firstJwk = await exportJWK(first.publicKey);
    const rotatedJwk = await exportJWK(rotated.publicKey);
    Object.assign(firstJwk, { kid: 'key-1', alg: 'RS256' });
    Object.assign(rotatedJwk, { kid: 'key-2', alg: 'RS256' });
    let activeKeys = [firstJwk];
    const remote = Object.assign(
      async (...args: Parameters<ReturnType<typeof jose.createLocalJWKSet>>) => (
        jose.createLocalJWKSet({ keys: activeKeys })(...args)
      ),
      {
        reload: vi.fn().mockImplementation(async () => { activeKeys = [firstJwk, rotatedJwk]; }),
        coolingDown: false,
        fresh: true,
        reloading: false,
        jwks: () => ({ keys: activeKeys }),
      }
    );
    const verifier = await buildVerifierWithRemote(appConfig, persistence, remote);
    const token = await signToken(rotated.privateKey, appConfig, {
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
      keyId: 'key-2',
    });

    await expect(verifier.verifyAccessToken(token, 'proposal')).resolves.toMatchObject({ kind: 'human' });
    expect(remote.reload).toHaveBeenCalledTimes(1);

    activeKeys = [firstJwk];
    remote.reload.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(verifier.verifyAccessToken(token, 'proposal')).rejects.toThrow(
      'OIDC access token is invalid or insufficient'
    );
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

  it('emits bounded security categories without token or claim values', async () => {
    const events: OidcSecurityEvent[] = [];
    const appConfig = config();
    const { verifier, privateKey } = await buildVerifier(appConfig, persistence, (event) => events.push(event));
    const valid = await signToken(privateKey, appConfig, {
      scope: 'openid managedskillhub:proposals',
      managedskillhub_human: true,
      email: 'private@example.test',
    });
    const invalid = await signToken(privateKey, appConfig, {
      scope: 'openid profile',
      managedskillhub_human: true,
    });

    await verifier.verifyAccessToken(valid, 'proposal');
    await expect(verifier.verifyAccessToken(invalid, 'proposal')).rejects.toThrow();

    expect(events).toEqual(expect.arrayContaining([
      { event: 'oidc_provider_initialization', outcome: 'success' },
      { event: 'oidc_token_validation', outcome: 'success', area: 'proposal', category: 'human' },
      { event: 'oidc_token_validation', outcome: 'failure', area: 'proposal', category: 'policy' },
    ]));
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(valid);
    expect(serialized).not.toContain('private@example.test');
    expect(serialized).not.toContain('user-uuid-1');
  });
});

async function buildVerifier(
  appConfig: AppConfig,
  persistence: SqliteIdentityPersistence,
  recordSecurityEvent?: OidcSecurityEventSink
) {
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
        introspection_endpoint: 'https://auth.example.test/application/o/introspect/',
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
    async () => joseAdapter,
    recordSecurityEvent
  );
  await verifier.initialize();
  return { verifier, privateKey };
}

async function buildVerifierWithRemote(
  appConfig: AppConfig,
  persistence: SqliteIdentityPersistence,
  remote: ReturnType<typeof import('jose')['createRemoteJWKSet']>
): Promise<AuthentikAccessTokenVerifier> {
  const jose = await import('jose');
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
        introspection_endpoint: 'https://auth.example.test/application/o/introspect/',
      }),
    }),
    None: vi.fn(),
    customFetch: Symbol('customFetch'),
  } as unknown as typeof import('openid-client');
  const policy = new AuthorizationPolicy(appConfig);
  const verifier = new AuthentikAccessTokenVerifier(
    appConfig,
    new PrincipalProjectionService(persistence, policy, appConfig),
    policy,
    async () => oidc,
    async () => joseAdapter
  );
  await verifier.initialize();
  return verifier;
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
  const notBefore = typeof overrides.notBefore === 'number' ? overrides.notBefore : now - 1;
  const subject = typeof overrides.subject === 'string' ? overrides.subject : 'user-uuid-1';
  const tokenType = typeof overrides.tokenType === 'string' ? overrides.tokenType : 'at+jwt';
  const keyId = typeof overrides.keyId === 'string' ? overrides.keyId : 'key-1';
  const payload = { ...overrides };
  delete payload.issuer;
  delete payload.audience;
  delete payload.expiration;
  delete payload.notBefore;
  delete payload.subject;
  delete payload.tokenType;
  delete payload.keyId;
  if (!Object.prototype.hasOwnProperty.call(payload, 'azp')) payload.azp = appConfig.oidcAgentClientId;
  if (!Object.prototype.hasOwnProperty.call(payload, 'uid')) payload.uid = 'access-token-uuid-1';
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: keyId, typ: tokenType })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt(now)
    .setNotBefore(notBefore)
    .setExpirationTime(expiration)
    .sign(privateKey);
}

function accessTokenHash(accessToken: string): string {
  const digest = createHash('sha256').update(accessToken, 'ascii').digest();
  return digest.subarray(0, digest.length / 2).toString('base64url');
}
