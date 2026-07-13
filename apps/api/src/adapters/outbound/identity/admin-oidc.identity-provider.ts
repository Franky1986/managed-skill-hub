import {
  AdminAuthorizationCallbackInput,
  AdminAuthorizationRequestInput,
  IdentityProviderPort,
  PreparedAuthorizationRequest,
} from '../../../application/ports/outbound/identity-provider.port';
import { VerifiedExternalIdentity } from '../../../application/security/principal-projection.service';
import { ConfigurationError, UnauthorizedError } from '../../../domain/errors';
import { AppConfig } from '../../../infrastructure/config';
import { loadOpenIdClient } from './openid-client-loader';
import { boundedProviderFetch as fetchBoundedProviderResponse } from './bounded-provider-fetch';

type OpenIdClientModule = typeof import('openid-client');
type OpenIdConfiguration = import('openid-client').Configuration;

const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

export class AdminOidcIdentityProvider implements IdentityProviderPort {
  private configurationPromise: Promise<OpenIdConfiguration> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly loadClient: () => Promise<OpenIdClientModule> = loadOpenIdClient
  ) {}

  async initialize(): Promise<void> {
    const client = await this.loadClient();
    await this.getConfiguration(client);
  }

  async prepareAdminAuthorization(
    input: AdminAuthorizationRequestInput
  ): Promise<PreparedAuthorizationRequest> {
    const client = await this.loadClient();
    const configuration = await this.getConfiguration(client);
    if (!configuration.serverMetadata().supportsPKCE('S256')) {
      throw new ConfigurationError('The configured OIDC provider does not advertise PKCE S256 support.');
    }
    const state = client.randomState();
    const nonce = client.randomNonce();
    const pkceVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(pkceVerifier);
    const authorizationUrl = client.buildAuthorizationUrl(configuration, {
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: input.scopes.join(' '),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return {
      authorizationUrl: authorizationUrl.toString(),
      state,
      nonce,
      pkceVerifier,
    };
  }

  async exchangeAdminAuthorization(
    input: AdminAuthorizationCallbackInput
  ): Promise<VerifiedExternalIdentity> {
    const client = await this.loadClient();
    const configuration = await this.getConfiguration(client);
    const callbackUrl = new URL(input.redirectUri);
    callbackUrl.search = input.callbackParameters.toString();
    try {
      const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
        expectedState: input.expectedState,
        expectedNonce: input.expectedNonce,
        pkceCodeVerifier: input.pkceVerifier,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || typeof claims.sub !== 'string' || claims.sub.length === 0) {
        throw new UnauthorizedError('OIDC callback did not contain a stable subject.');
      }
      return {
        issuer: this.requireAdminIssuer(),
        subject: claims.sub,
        clientId: this.requireAdminClientId(),
        kind: serviceIdentityClaim(claims) ? 'service' : 'human',
        displayName: firstStringClaim(claims, ['name', 'preferred_username']),
        email: firstStringClaim(claims, ['email']),
        groups: stringArrayClaim(claims.groups, this.config.oidcMaxGroups),
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      throw new UnauthorizedError('OIDC authorization callback validation failed.');
    }
  }

  private async getConfiguration(client: OpenIdClientModule): Promise<OpenIdConfiguration> {
    const issuerUrl = new URL(this.requireAdminIssuer());
    this.configurationPromise ??= client.discovery(
      issuerUrl,
      this.requireAdminClientId(),
      {
        client_secret: this.requireAdminClientSecret(),
        redirect_uris: [this.requireAdminRedirectUri()],
        response_types: ['code'],
      },
      client.ClientSecretPost(this.requireAdminClientSecret()),
      {
        timeout: Math.max(1, Math.ceil(this.config.oidcHttpTimeoutMs / 1000)),
        [client.customFetch]: boundedProviderFetch(
          issuerUrl.origin,
          MAX_PROVIDER_RESPONSE_BYTES
        ),
        execute: issuerUrl.protocol === 'http:' ? [client.allowInsecureRequests] : undefined,
      }
    );
    const configuration = await this.configurationPromise;
    validateAdminProviderMetadata(configuration.serverMetadata(), issuerUrl);
    return configuration;
  }

  private requireAdminIssuer(): string {
    return required(this.config.oidcAdminIssuer, 'OIDC_ADMIN_ISSUER');
  }

  private requireAdminClientId(): string {
    return required(this.config.oidcAdminClientId, 'OIDC_ADMIN_CLIENT_ID');
  }

  private requireAdminClientSecret(): string {
    return required(this.config.oidcAdminClientSecret, 'OIDC_ADMIN_CLIENT_SECRET');
  }

  private requireAdminRedirectUri(): string {
    return required(this.config.oidcAdminRedirectUri, 'OIDC_ADMIN_REDIRECT_URI');
  }
}

function validateAdminProviderMetadata(
  metadata: import('openid-client').ServerMetadata,
  issuerUrl: URL
): void {
  if (metadata.issuer !== issuerUrl.toString()) {
    throw new ConfigurationError('OIDC discovery issuer does not match OIDC_ADMIN_ISSUER.');
  }
  trustedProviderEndpoint(metadata.authorization_endpoint, issuerUrl.origin, 'authorization_endpoint');
  trustedProviderEndpoint(metadata.token_endpoint, issuerUrl.origin, 'token_endpoint');
  trustedProviderEndpoint(metadata.jwks_uri, issuerUrl.origin, 'jwks_uri');
}

function trustedProviderEndpoint(value: string | undefined, origin: string, name: string): void {
  if (!value) {
    throw new ConfigurationError(`OIDC discovery is missing ${name}.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(`OIDC discovery ${name} is not a valid URL.`);
  }
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.hash) {
    throw new ConfigurationError(`OIDC discovery ${name} is outside the trusted provider origin.`);
  }
}

function boundedProviderFetch(trustedOrigin: string, maxBytes: number) {
  return async (url: string, options: import('openid-client').CustomFetchOptions): Promise<Response> => {
    return fetchBoundedProviderResponse(url, options as RequestInit, { trustedOrigin, maxBytes });
  };
}

function required(value: string | null, name: string): string {
  if (!value) {
    throw new ConfigurationError(`${name} is required for administrator OIDC.`);
  }
  return value;
}

function firstStringClaim(
  claims: Record<string, unknown>,
  names: string[]
): string | null {
  for (const name of names) {
    const value = claims[name];
    if (typeof value === 'string' && value.length > 0 && value.length <= 512) {
      return value;
    }
  }
  return null;
}

function stringArrayClaim(value: unknown, maxGroups: number): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > maxGroups) {
    throw new UnauthorizedError('OIDC group claims are invalid.');
  }
  const groups = value.filter((entry): entry is string => (
    typeof entry === 'string' && entry.length > 0 && entry.length <= 255
  ));
  if (groups.length !== value.length) {
    throw new UnauthorizedError('OIDC group claims are invalid.');
  }
  return [...new Set(groups)];
}

function serviceIdentityClaim(claims: Record<string, unknown>): boolean {
  return claims.is_service_account === true || claims.service_account === true;
}
