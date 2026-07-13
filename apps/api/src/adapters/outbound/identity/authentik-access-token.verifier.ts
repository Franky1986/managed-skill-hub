import { createHash, timingSafeEqual } from 'node:crypto';
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
import { boundedProviderFetch as fetchBoundedProviderResponse } from './bounded-provider-fetch';

type JoseModule = typeof import('jose');
type OpenIdClientModule = typeof import('openid-client');
type RemoteJwkSet = ReturnType<JoseModule['createRemoteJWKSet']>;

export interface OidcSecurityEvent {
  event:
    | 'oidc_provider_initialization'
    | 'oidc_token_validation'
    | 'oidc_id_token_evidence'
    | 'oidc_jwks_refresh';
  outcome: 'success' | 'failure' | 'started';
  area?: AgentTokenArea;
  category?: string;
}

export type OidcSecurityEventSink = (event: OidcSecurityEvent) => void;

export interface VerifiedOidcIdTokenEvidence {
  subject: string;
  accessTokenBinding: 'at_hash' | 'same_subject';
}

const ALLOWED_ALGORITHMS = ['RS256', 'PS256', 'ES256'] as const;
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

export class AuthentikAccessTokenVerifier implements AccessTokenVerifierPort {
  private initialization: Promise<void> | null = null;
  private resolvedMetadata: AgentOidcMetadata | null = null;
  private remoteJwks: RemoteJwkSet | null = null;
  private introspectionEndpoint: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly projection: PrincipalProjectionService,
    private readonly policy: AuthorizationPolicy,
    private readonly loadOidc: () => Promise<OpenIdClientModule> = loadOpenIdClient,
    private readonly loadJwt: () => Promise<JoseModule> = loadJose,
    private readonly recordSecurityEvent: OidcSecurityEventSink = () => undefined
  ) {}

  initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce()
      .then(() => this.recordSecurityEvent({
        event: 'oidc_provider_initialization',
        outcome: 'success',
      }))
      .catch((error) => {
        this.recordSecurityEvent({
          event: 'oidc_provider_initialization',
          outcome: 'failure',
          category: 'discovery_or_configuration',
        });
        throw error;
      });
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
      const { payload, protectedHeader } = await jose.jwtVerify(
        token,
        unknownKeyRefresh(jwks, this.recordSecurityEvent),
        {
        issuer: metadata.issuer,
        audience: metadata.clientId,
        algorithms: [...ALLOWED_ALGORITHMS],
        clockTolerance: this.config.oidcClockToleranceSeconds,
        }
      );
      validateTokenType(protectedHeader.typ, this.config.oidcAccessTokenValidationMode);
      if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) {
        throw new Error('missing subject');
      }
      if (typeof payload.uid !== 'string' || payload.uid.length === 0 || payload.uid.length > 255) {
        throw new Error('missing Authentik access-token identifier');
      }
      validateAuthorizedParty(payload, metadata.clientId);
      if (this.config.oidcAccessTokenValidationMode === 'authentik_introspection') {
        await this.validateByIntrospection(token, payload.sub, metadata.clientId);
      }
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
      this.recordSecurityEvent({
        event: 'oidc_token_validation',
        outcome: 'success',
        area,
        category: principal.kind,
      });
      return principal;
    } catch (error) {
      this.recordSecurityEvent({
        event: 'oidc_token_validation',
        outcome: 'failure',
        area,
        category: tokenFailureCategory(error),
      });
      throw new UnauthorizedError('OIDC access token is invalid or insufficient for this API area.');
    }
  }

  async verifyIdTokenEvidence(
    idToken: string,
    accessToken: string,
    expectedSubject: string
  ): Promise<VerifiedOidcIdTokenEvidence> {
    if (
      Buffer.byteLength(idToken, 'utf8') > this.config.oidcMaxTokenBytes
      || idToken.split('.').length !== 3
      || Buffer.byteLength(accessToken, 'utf8') > this.config.oidcMaxTokenBytes
      || accessToken.split('.').length !== 3
      || expectedSubject.length === 0
      || expectedSubject.length > 255
    ) {
      throw new UnauthorizedError('OIDC ID token evidence is invalid.');
    }
    await this.initialize();
    const metadata = this.resolvedMetadata;
    const jwks = this.remoteJwks;
    if (!metadata || !jwks) {
      throw new UnauthorizedError('OIDC ID token evidence validation is unavailable.');
    }
    const jose = await this.loadJwt();
    try {
      const { payload, protectedHeader } = await jose.jwtVerify(
        idToken,
        unknownKeyRefresh(jwks, this.recordSecurityEvent),
        {
          issuer: metadata.issuer,
          audience: metadata.clientId,
          algorithms: [...ALLOWED_ALGORITHMS],
          clockTolerance: this.config.oidcClockToleranceSeconds,
          requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
        }
      );
      if (protectedHeader.typ !== undefined && protectedHeader.typ !== 'JWT') {
        throw new Error('unexpected ID token type');
      }
      if (payload.sub !== expectedSubject || payload.sub.length > 255) {
        throw new Error('ID token subject mismatch');
      }
      validateIdTokenAudience(payload, metadata.clientId);
      const accessTokenBinding = validateAccessTokenHash(
        payload.at_hash,
        accessToken,
        protectedHeader.alg
      );
      this.recordSecurityEvent({
        event: 'oidc_id_token_evidence',
        outcome: 'success',
        category: accessTokenBinding,
      });
      return { subject: payload.sub, accessTokenBinding };
    } catch (error) {
      this.recordSecurityEvent({
        event: 'oidc_id_token_evidence',
        outcome: 'failure',
        category: tokenFailureCategory(error),
      });
      throw new UnauthorizedError('OIDC ID token evidence is invalid.');
    }
  }

  private async initializeOnce(): Promise<void> {
    const issuer = required(this.config.oidcAgentIssuer, 'OIDC_AGENT_ISSUER');
    const clientId = required(this.config.oidcAgentClientId, 'OIDC_AGENT_CLIENT_ID');
    const issuerUrl = new URL(issuer);
    const trustedOrigin = issuerUrl.origin;
    const oidc = await this.loadOidc();
    const configuration = await oidc.discovery(
      issuerUrl,
      clientId,
      { token_endpoint_auth_method: 'none' },
      oidc.None(),
      {
        timeout: Math.max(1, Math.ceil(this.config.oidcHttpTimeoutMs / 1000)),
        [oidc.customFetch]: boundedProviderFetch(trustedOrigin, MAX_PROVIDER_RESPONSE_BYTES),
        execute: issuerUrl.protocol === 'http:' ? [oidc.allowInsecureRequests] : undefined,
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
    this.introspectionEndpoint = this.config.oidcAccessTokenValidationMode === 'authentik_introspection'
      ? trustedEndpoint(metadata.introspection_endpoint, trustedOrigin, 'introspection_endpoint')
      : null;
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

  private async validateByIntrospection(token: string, subject: string, clientId: string): Promise<void> {
    const endpoint = required(this.introspectionEndpoint, 'OIDC introspection endpoint');
    const introspectionClientId = required(
      this.config.oidcIntrospectionClientId,
      'OIDC_INTROSPECTION_CLIENT_ID'
    );
    const introspectionClientSecret = required(
      this.config.oidcIntrospectionClientSecret,
      'OIDC_INTROSPECTION_CLIENT_SECRET'
    );
    const body = new URLSearchParams({ token, token_type_hint: 'access_token' });
    const response = await fetchBoundedProviderResponse(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${introspectionClientId}:${introspectionClientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(this.config.oidcHttpTimeoutMs),
    }, {
      trustedOrigin: new URL(endpoint).origin,
      maxBytes: MAX_PROVIDER_RESPONSE_BYTES,
    });
    if (!response.ok) {
      throw new Error('access token introspection failed');
    }
    const result = await response.json() as Record<string, unknown>;
    if (result.active !== true || result.client_id !== clientId || result.sub !== subject) {
      throw new Error('access token introspection rejected token');
    }
  }
}

function unknownKeyRefresh(remote: RemoteJwkSet, record: OidcSecurityEventSink): RemoteJwkSet {
  return (async (protectedHeader, token) => {
    try {
      return await remote(protectedHeader, token);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') {
        throw error;
      }
      record({ event: 'oidc_jwks_refresh', outcome: 'started', category: 'unknown_kid' });
      try {
        await remote.reload();
        const key = await remote(protectedHeader, token);
        record({ event: 'oidc_jwks_refresh', outcome: 'success', category: 'unknown_kid' });
        return key;
      } catch (reloadError) {
        record({ event: 'oidc_jwks_refresh', outcome: 'failure', category: 'provider_or_key' });
        throw reloadError;
      }
    }
  }) as RemoteJwkSet;
}

function tokenFailureCategory(error: unknown): string {
  const code = (error as { code?: string }).code ?? '';
  if (code.includes('EXPIRED') || code.includes('CLAIM_VALIDATION_FAILED')) return 'time_or_claim';
  if (code.includes('JWS') || code.includes('JWKS') || code.includes('JOSE')) return 'signature_or_key';
  const message = error instanceof Error ? error.message : '';
  if (message.includes('scope') || message.includes('policy') || message.includes('human')) return 'policy';
  if (message.includes('subject') || message.includes('authorized party') || message.includes('token type')) {
    return 'token_claim';
  }
  return 'invalid_token';
}

function validateAuthorizedParty(payload: import('jose').JWTPayload, clientId: string): void {
  if (payload.azp !== clientId) {
    throw new Error('authorized party mismatch');
  }
}

function validateIdTokenAudience(payload: import('jose').JWTPayload, clientId: string): void {
  const audiences = typeof payload.aud === 'string' ? [payload.aud] : payload.aud;
  if (!audiences?.includes(clientId)) {
    throw new Error('ID token audience mismatch');
  }
  if (audiences.length > 1 && payload.azp !== clientId) {
    throw new Error('ID token authorized party missing');
  }
  if (payload.azp !== undefined && payload.azp !== clientId) {
    throw new Error('ID token authorized party mismatch');
  }
}

function validateAccessTokenHash(
  value: unknown,
  accessToken: string,
  algorithm: string
): VerifiedOidcIdTokenEvidence['accessTokenBinding'] {
  if (value === undefined) {
    return 'same_subject';
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('invalid access token hash');
  }
  const hashAlgorithm = algorithm.endsWith('256')
    ? 'sha256'
    : algorithm.endsWith('384')
      ? 'sha384'
      : algorithm.endsWith('512')
        ? 'sha512'
        : null;
  if (!hashAlgorithm) {
    throw new Error('unsupported access token hash algorithm');
  }
  const digest = createHash(hashAlgorithm).update(accessToken, 'ascii').digest();
  const expected = digest.subarray(0, digest.length / 2).toString('base64url');
  const expectedBytes = Buffer.from(expected, 'ascii');
  const actualBytes = Buffer.from(value, 'ascii');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error('access token hash mismatch');
  }
  return 'at_hash';
}

function validateTokenType(
  value: string | undefined,
  mode: AppConfig['oidcAccessTokenValidationMode']
): void {
  if (mode === 'jwt_profile') {
    if (value !== 'at+jwt' && value !== 'application/at+jwt') {
      throw new Error('unexpected token type');
    }
    return;
  }
  if (value !== 'JWT' && value !== 'at+jwt' && value !== 'application/at+jwt') {
    throw new Error('unexpected token type');
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
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(`OIDC discovery ${name} is not a valid URL.`);
  }
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.hash) {
    throw new ConfigurationError(`OIDC discovery ${name} is outside the trusted provider origin.`);
  }
  return parsed.toString();
}

function boundedProviderFetch(trustedOrigin: string, maxBytes: number) {
  return async (url: string, options: import('openid-client').CustomFetchOptions): Promise<Response> => {
    return fetchBoundedProviderResponse(url, options as RequestInit, { trustedOrigin, maxBytes });
  };
}

function boundedJwksFetch(trustedOrigin: string, maxBytes: number) {
  return async (url: string, options: RequestInit): Promise<Response> => {
    return fetchBoundedProviderResponse(url, options, { trustedOrigin, maxBytes });
  };
}

function required(value: string | null, name: string): string {
  if (!value) {
    throw new ConfigurationError(`${name} is required for OIDC access-token validation.`);
  }
  return value;
}
