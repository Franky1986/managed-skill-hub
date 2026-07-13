import { describe, expect, it, vi } from 'vitest';
import { AppConfig } from '../../../infrastructure/config';
import { AdminOidcIdentityProvider } from './admin-oidc.identity-provider';

function config(): AppConfig {
  return {
    oidcAdminIssuer: 'https://auth.example.test/application/o/admin/',
    oidcAdminClientId: 'managedskillhub-admin-web',
    oidcAdminClientSecret: 'client-secret',
    oidcAdminRedirectUri: 'https://skills.example.test/api/admin/auth/oidc/callback',
    oidcHttpTimeoutMs: 5000,
    oidcMaxGroups: 100,
  } as AppConfig;
}

describe('AdminOidcIdentityProvider', () => {
  it('uses S256 and validates state, nonce, PKCE, and an ID Token through openid-client', async () => {
    const configuration = {
      serverMetadata: () => ({ supportsPKCE: (method: string) => method === 'S256' }),
    };
    const authorizationCodeGrant = vi.fn().mockResolvedValue({
      claims: () => ({
        sub: 'user-uuid-1',
        name: 'OIDC Admin',
        email: 'admin@example.test',
        groups: ['managedskillhub-admins'],
      }),
    });
    const client = {
      discovery: vi.fn().mockResolvedValue(configuration),
      ClientSecretPost: vi.fn().mockReturnValue('client-auth'),
      customFetch: Symbol('customFetch'),
      randomState: vi.fn().mockReturnValue('state-1'),
      randomNonce: vi.fn().mockReturnValue('nonce-1'),
      randomPKCECodeVerifier: vi.fn().mockReturnValue('verifier-1'),
      calculatePKCECodeChallenge: vi.fn().mockResolvedValue('challenge-1'),
      buildAuthorizationUrl: vi.fn().mockReturnValue(new URL('https://auth.example.test/authorize')),
      authorizationCodeGrant,
    } as unknown as typeof import('openid-client');
    const provider = new AdminOidcIdentityProvider(config(), async () => client);

    const prepared = await provider.prepareAdminAuthorization({
      redirectUri: config().oidcAdminRedirectUri!,
      scopes: ['openid', 'profile', 'email'],
    });
    const identity = await provider.exchangeAdminAuthorization({
      callbackParameters: new URLSearchParams({ code: 'code-1', state: 'state-1' }),
      redirectUri: config().oidcAdminRedirectUri!,
      expectedState: 'state-1',
      expectedNonce: 'nonce-1',
      pkceVerifier: 'verifier-1',
    });

    expect(prepared).toMatchObject({ state: 'state-1', nonce: 'nonce-1', pkceVerifier: 'verifier-1' });
    expect(client.buildAuthorizationUrl).toHaveBeenCalledWith(configuration, expect.objectContaining({
      response_type: 'code',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      state: 'state-1',
      nonce: 'nonce-1',
    }));
    expect(authorizationCodeGrant).toHaveBeenCalledWith(
      configuration,
      expect.any(URL),
      {
        expectedState: 'state-1',
        expectedNonce: 'nonce-1',
        pkceCodeVerifier: 'verifier-1',
        idTokenExpected: true,
      }
    );
    expect(identity).toEqual({
      issuer: config().oidcAdminIssuer,
      subject: 'user-uuid-1',
      clientId: config().oidcAdminClientId,
      kind: 'human',
      displayName: 'OIDC Admin',
      email: 'admin@example.test',
      groups: ['managedskillhub-admins'],
    });
  });

  it('fails closed when callback validation fails or claims are malformed', async () => {
    const configuration = {
      serverMetadata: () => ({ supportsPKCE: () => true }),
    };
    const client = {
      discovery: vi.fn().mockResolvedValue(configuration),
      ClientSecretPost: vi.fn(),
      customFetch: Symbol('customFetch'),
      authorizationCodeGrant: vi.fn().mockRejectedValue(new Error('provider details')),
    } as unknown as typeof import('openid-client');
    const provider = new AdminOidcIdentityProvider(config(), async () => client);

    await expect(provider.exchangeAdminAuthorization({
      callbackParameters: new URLSearchParams({ code: 'code', state: 'state' }),
      redirectUri: config().oidcAdminRedirectUri!,
      expectedState: 'state',
      expectedNonce: 'nonce',
      pkceVerifier: 'verifier',
    })).rejects.toThrow('OIDC authorization callback validation failed');
  });
});
