import {
  AccessTokenVerifierPort,
  AgentOidcMetadata,
  AgentTokenArea,
} from '../../../application/ports/outbound/access-token-verifier.port';
import { AuthenticatedPrincipal } from '../../../application/security/authenticated-principal';
import { AuthorizationPolicy } from '../../../application/security/authorization-policy';
import { PrincipalProjectionService } from '../../../application/security/principal-projection.service';
import { ConfigurationError, UnauthorizedError } from '../../../domain/errors';
import { AppConfig } from '../../../infrastructure/config';
import { loadJose } from './jose-loader';
import { loadOpenIdClient } from './openid-client-loader';

type JoseModule = typeof import('jose');
type OpenIdClientModule = typeof import('openid-client');
type RemoteJwkSet = ReturnType<JoseModule['createRemoteJWKSet']>;

const ALLOWED_ALGORITHMS = ['RS256', 'PS256', 'ES256'] as const;
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

export class AuthentikAccessTokenVerifier implements AccessTokenVerifierPort {
  private initialization: Promise<void> | null = null;
  private resolvedMetadata: AgentOidcMetadata | null = null;
  private remoteJwks: RemoteJwkSet | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly projection: PrincipalProjectionService,
    private readonly policy: AuthorizationPolicy,
    private readonly loadOidc: () => Promise<OpenIdClientModule> = loadOpenIdClient,
    private readonly loadJwt: () => Promise<JoseModule> = loadJose
  ) {}

  initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  metadata(): AgentOidcMetadata | null {
    return this.resolvedMetadata;
  }

  async verifyAccessToken(token: string, area: AgentTokenArea): Promise<AuthenticatedPrincipal> {
    if (Buffer.byteLength(token, 'utf8') > this.config.oidcMaxTokenBytes || token.split('.').length !== 3) {
      throw new UnauthorizedError('OIDC access token is invalid.');
    }
    await this.initialize();
    const metadata = this.resolvedMetadata;
    const jwks = this.remoteJwks;
    if (!metadata || !jwks) {
      throw new UnauthorizedError('OIDC access token validation is unavailable.');
    }
    const jose = await this.loadJwt();
    try {
      const { payload, protectedHeader } = await jose.jwtVerify(token, unknownKeyRefresh(jwks), {
        issuer: metadata.issuer,
        audience: metadata.clientId,
        algorithms: [...ALLOWED_ALGORITHMS],
        clockTolerance: this.config.oidcClockToleranceSeconds,
      });
      if (protectedHeader.typ && protectedHeader.typ !== 'JWT' && protectedHeader.typ !== 'at+jwt') {
        throw new Error('unexpected token type');
      }
      if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) {
        throw new Error('missing subject');
      }
      validateAuthorizedParty(payload, metadata.clientId);
      const requiredScope = scopeForArea(this.config, area);
      const scopes = parseScopes(payload.scope);
      if (!scopes.has('openid') || !scopes.has(requiredScope)) {
        throw new Error('missing scope');
      }
      const isHuman = payload[this.config.oidcHumanClaim] === true;
      if (area === 'proposal' && !isHuman) {
        throw new Error('human delegation required');
      }
      const principal = await this.projection.project({
        issuer: metadata.issuer,
        subject: payload.sub,
        clientId: metadata.clientId,
        kind: isHuman ? 'human' : 'service',
        displayName: firstStringClaim(payload, ['name', 'preferred_username']),
        email: firstStringClaim(payload, ['email']),
        groups: stringArrayClaim(payload.groups, this.config.oidcMaxGroups),
      });
      if (!this.policy.canAccessArea(principal, area)) {
        throw new Error('area policy denied');
      }
      return principal;
    } catch {
      throw new UnauthorizedError('OIDC access token is invalid or insufficient for this API area.');
    }
  }

  private async initializeOnce(): Promise<void> {
    const issuer = required(this.config.oidcAgentIssuer, 'OIDC_AGENT_ISSUER');
    const clientId = required(this.config.oidcAgentClientId, 'OIDC_AGENT_CLIENT_ID');
    const trustedOrigin = new URL(issuer).origin;
    const oidc = await this.loadOidc();
    const configuration = await oidc.discovery(
      new URL(issuer),
      clientId,
      { token_endpoint_auth_method: 'none' },
      oidc.None(),
      {
        timeout: Math.max(1, Math.ceil(this.config.oidcHttpTimeoutMs / 1000)),
        [oidc.customFetch]: boundedProviderFetch(trustedOrigin, MAX_PROVIDER_RESPONSE_BYTES),
      }
    );
    const metadata = configuration.serverMetadata();
    if (metadata.issuer !== issuer) {
      throw new ConfigurationError('OIDC discovery issuer does not match OIDC_AGENT_ISSUER.');
    }
    const authorizationEndpoint = trustedEndpoint(metadata.authorization_endpoint, trustedOrigin, 'authorization_endpoint');
    const deviceAuthorizationEndpoint = trustedEndpoint(
      metadata.device_authorization_endpoint,
      trustedOrigin,
      'device_authorization_endpoint'
    );
    const tokenEndpoint = trustedEndpoint(metadata.token_endpoint, trustedOrigin, 'token_endpoint');
    const jwksUri = trustedEndpoint(metadata.jwks_uri, trustedOrigin, 'jwks_uri');
    this.resolvedMetadata = {
      issuer,
      openIdConfigurationUrl: `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
      authorizationEndpoint,
      deviceAuthorizationEndpoint,
      tokenEndpoint,
      jwksUri,
      clientId,
    };
    const jose = await this.loadJwt();
    this.remoteJwks = jose.createRemoteJWKSet(new URL(jwksUri), {
      timeoutDuration: this.config.oidcHttpTimeoutMs,
      cacheMaxAge: this.config.oidcJwksCacheTtlSeconds * 1000,
      cooldownDuration: 30_000,
      [jose.customFetch]: boundedJwksFetch(trustedOrigin, MAX_PROVIDER_RESPONSE_BYTES),
    });
  }
}

function unknownKeyRefresh(remote: RemoteJwkSet): RemoteJwkSet {
  return (async (protectedHeader, token) => {
    try {
      return await remote(protectedHeader, token);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') {
        throw error;
      }
      await remote.reload();
      return remote(protectedHeader, token);
    }
  }) as RemoteJwkSet;
}

function validateAuthorizedParty(payload: import('jose').JWTPayload, clientId: string): void {
  if (payload.azp !== undefined && payload.azp !== clientId) {
    throw new Error('authorized party mismatch');
  }
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) {
    throw new Error('authorized party required for multiple audiences');
  }
}

function parseScopes(value: unknown): Set<string> {
  if (typeof value !== 'string' || value.length > 4096) {
    throw new Error('invalid scope claim');
  }
  const scopes = value.split(/\s+/).filter(Boolean);
  if (scopes.length > 100) {
    throw new Error('too many scopes');
  }
  return new Set(scopes);
}

function scopeForArea(config: AppConfig, area: AgentTokenArea): string {
  const value = area === 'discovery'
    ? config.oidcDiscoveryScope
    : area === 'public-read'
      ? config.oidcPublicReadScope
      : config.oidcProposalScope;
  return required(value, `OIDC_${area.toUpperCase().replace('-', '_')}_SCOPE`);
}

function firstStringClaim(payload: import('jose').JWTPayload, names: string[]): string | null {
  for (const name of names) {
    const value = payload[name];
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
    throw new Error('invalid groups claim');
  }
  const groups = value.filter((entry): entry is string => (
    typeof entry === 'string' && entry.length > 0 && entry.length <= 255
  ));
  if (groups.length !== value.length || new Set(groups).size !== groups.length) {
    throw new Error('invalid groups claim');
  }
  return groups;
}

function trustedEndpoint(value: string | undefined, origin: string, name: string): string {
  if (!value) {
    throw new ConfigurationError(`OIDC discovery is missing ${name}.`);
  }
  const parsed = new URL(value);
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.hash) {
    throw new ConfigurationError(`OIDC discovery ${name} is outside the trusted provider origin.`);
  }
  return parsed.toString();
}

function boundedProviderFetch(trustedOrigin: string, maxBytes: number) {
  return async (url: string, options: import('openid-client').CustomFetchOptions): Promise<Response> => {
    return boundedFetch(url, options as RequestInit, trustedOrigin, maxBytes);
  };
}

function boundedJwksFetch(trustedOrigin: string, maxBytes: number) {
  return async (url: string, options: RequestInit): Promise<Response> => {
    return boundedFetch(url, options, trustedOrigin, maxBytes);
  };
}

async function boundedFetch(
  url: string,
  options: RequestInit,
  trustedOrigin: string,
  maxBytes: number
): Promise<Response> {
  const target = new URL(url);
  if (target.origin !== trustedOrigin) {
    throw new Error('OIDC provider endpoint left the configured trusted origin.');
  }
  const response = await fetch(target, { ...options, redirect: 'manual' });
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) {
    throw new Error('OIDC provider response exceeded the configured size limit.');
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maxBytes) {
    throw new Error('OIDC provider response exceeded the configured size limit.');
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function required(value: string | null, name: string): string {
  if (!value) {
    throw new ConfigurationError(`${name} is required for OIDC access-token validation.`);
  }
  return value;
}
