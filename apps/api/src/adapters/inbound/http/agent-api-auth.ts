import crypto from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AgentAuthMode, AppConfig } from '../../../infrastructure/config';
import { AgentAuthRequiredError } from '../../../domain/errors';
import {
  agentSessionPrincipal,
  anonymousAgentPrincipal,
  AuthenticatedPrincipal,
  staticBearerPrincipal,
} from '../../../application/security/authenticated-principal';
import { AccessTokenVerifierPort, AgentOidcMetadata } from '../../../application/ports/outbound/access-token-verifier.port';
import { ValidateAgentSessionUseCase } from '../../../application/usecases/agent-session/validate-agent-session.usecase';

export type AgentAuthArea = 'discovery' | 'public-read' | 'proposal';

export interface AgentAuthContext {
  area: AgentAuthArea;
  actor: string;
  scheme: 'none' | 'bearer' | 'oidc' | 'agent-session';
  principal: AuthenticatedPrincipal;
}

interface AreaConfig {
  mode: AgentAuthMode;
  token: string | null;
  actor: string;
}

interface SessionFailureBucket {
  windowStart: number;
  failures: number;
}

export class AgentApiAuth {
  private readonly sessionFailureBuckets = new Map<string, SessionFailureBucket>();
  private lastSessionFailureCleanupAt = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly tokenVerifier?: AccessTokenVerifierPort,
    private readonly validateSessionUseCase?: ValidateAgentSessionUseCase
  ) {}

  guard(area: AgentAuthArea) {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      const context = await this.authenticate(area, request);
      (request as FastifyRequest & { agentAuth?: AgentAuthContext }).agentAuth = context;
    };
  }

  async authenticate(area: AgentAuthArea, request: FastifyRequest): Promise<AgentAuthContext> {
    const areaConfig = this.getAreaConfig(area);
    if (areaConfig.mode === 'none') {
      return {
        area,
        actor: 'anonymous-agent',
        scheme: 'none',
        principal: anonymousAgentPrincipal(),
      };
    }

    if (areaConfig.mode === 'oidc') {
      const token = readBearerToken(request.headers.authorization);
      if (!token || !this.tokenVerifier) {
        request.log.warn({
          event: 'agent_authentication',
          outcome: 'failure',
          area,
          scheme: 'oidc',
          category: token ? 'verifier_unavailable' : 'credential_missing',
        }, 'Agent authentication denied');
        throw this.authRequired(area, 'oidc');
      }
      try {
        const principal = await this.tokenVerifier.verifyAccessToken(token, area);
        request.log.info({
          event: 'agent_authentication',
          outcome: 'success',
          area,
          scheme: 'oidc',
          principalKind: principal.kind,
          clientId: principal.clientId,
        }, 'Agent authentication succeeded');
        return {
          area,
          actor: principal.principalId,
          scheme: 'oidc',
          principal,
        };
      } catch {
        request.log.warn({
          event: 'agent_authentication',
          outcome: 'failure',
          area,
          scheme: 'oidc',
          category: 'invalid_or_insufficient',
        }, 'Agent authentication denied');
        throw this.authRequired(area, 'oidc');
      }
    }

    const token = readBearerToken(request.headers.authorization);
    if (token && areaConfig.token && constantTimeEquals(token, areaConfig.token)) {
      return {
        area,
        actor: areaConfig.actor,
        scheme: 'bearer',
        principal: staticBearerPrincipal(areaConfig.actor),
      };
    }

    if (this.config.agentSessionEnabled && this.validateSessionUseCase) {
      const sessionCode = readAgentSessionCode(request.headers.authorization);
      if (sessionCode) {
        const attemptKey = request.ip ?? 'unknown';
        if (this.isSessionAttemptBlocked(attemptKey)) {
          request.log.warn({
            event: 'agent_authentication',
            outcome: 'failure',
            area,
            scheme: 'agent-session',
            category: 'rate_limited',
          }, 'Agent session authentication denied');
          throw this.authRequired(area, 'bearer');
        }
        const result = await this.validateSessionUseCase.execute({
          code: sessionCode,
          area,
          usedByIp: request.ip ?? null,
        });
        if (result.valid && result.sessionId) {
          request.log.info({
            event: 'agent_authentication',
            outcome: 'success',
            area,
            scheme: 'agent-session',
            sessionId: result.sessionId,
          }, 'Agent session authentication succeeded');
          return {
            area,
            actor: `agent-session:${result.sessionId}`,
            scheme: 'agent-session',
            principal: agentSessionPrincipal(result.sessionId, result.areas ?? [area]),
          };
        }
        if (result.reason === 'area_not_allowed' && result.sessionAreas) {
          request.log.warn({
            event: 'agent_authentication',
            outcome: 'failure',
            area,
            scheme: 'agent-session',
            category: 'area_not_allowed',
            sessionAreas: result.sessionAreas,
          }, 'Agent session lacks requested area');
          throw this.authRequired(area, 'bearer', {
            missingAreas: result.sessionAreas,
          });
        }
        this.recordSessionFailure(attemptKey);
        request.log.warn({
          event: 'agent_authentication',
          outcome: 'failure',
          area,
          scheme: 'agent-session',
          category: 'invalid_or_expired',
        }, 'Agent session authentication denied');
      }
    }

    throw this.authRequired(area, 'bearer');
  }

  metadata() {
    return {
      registryId: this.config.registryId ?? 'local',
      registryName: this.config.registryName ?? 'ManagedSkillHub Local',
      apiBaseUrl: this.config.publicApiBaseUrl ?? 'http://localhost:3040',
      readAuthRequired: this.publicReadMode() !== 'none',
      proposalAuthRequired: this.proposalMode() !== 'none',
      discoveryAuthRequired: this.discoveryMode() !== 'none',
      authSchemes: this.authSchemes(),
    };
  }

  private authSchemes(): AgentAuthScheme[] {
    const schemes: AgentAuthScheme[] = [];
    if (this.config.agentSessionEnabled && this.anyBearerAuthEnabled()) {
      const sessionAreas: AgentAuthArea[] = [];
      if (this.discoveryMode() === 'bearer') sessionAreas.push('discovery');
      if (this.publicReadMode() === 'bearer') sessionAreas.push('public-read');
      if (this.proposalMode() === 'bearer') sessionAreas.push('proposal');
      if (sessionAreas.length > 0) {
        const authUrl = this.agentSessionUrl() ?? (this.config.publicApiBaseUrl ?? 'http://localhost:3040') + '/frontend/agent-auth';
        schemes.push({
          id: 'agent-session',
          type: 'agent-session',
          appliesTo: sessionAreas,
          instructions: 'Open this URL with an in-app browser, browser MCP, or a local browser tab so the user can see the page, then enter the bearer token from the administrator. Paste the returned 8-character session code into the chat. If no browser tool is available, show the URL as a clickable link and ask the user to open it manually.',
          url: authUrl,
        });
      }
    }
    if (this.publicReadMode() === 'bearer') {
      schemes.push({ id: 'public-read-bearer', type: 'bearer', appliesTo: ['public-read'] });
    }
    if (this.proposalMode() === 'bearer') {
      schemes.push({ id: 'proposal-bearer', type: 'bearer', appliesTo: ['proposal'] });
    }
    if (this.discoveryMode() === 'bearer') {
      schemes.push({ id: 'discovery-bearer', type: 'bearer', appliesTo: ['discovery'] });
    }
    const oidcAreas: AgentAuthArea[] = [];
    if (this.discoveryMode() === 'oidc') oidcAreas.push('discovery');
    if (this.publicReadMode() === 'oidc') oidcAreas.push('public-read');
    if (this.proposalMode() === 'oidc') oidcAreas.push('proposal');
    if (oidcAreas.length > 0) {
      schemes.push(this.oidcScheme(oidcAreas, this.tokenVerifier?.metadata() ?? null));
    }
    return schemes;
  }

  private isSessionAttemptBlocked(key: string): boolean {
    const now = Date.now();
    const windowMs = this.config.agentSessionAuthRateLimitWindowMs ?? 60_000;
    this.cleanupSessionFailureBuckets(now, windowMs);
    const bucket = this.sessionFailureBuckets.get(key);
    if (bucket) {
      return bucket.failures >= (this.config.agentSessionAuthRateLimitMaxFailures ?? 30);
    }
    return this.sessionFailureBuckets.size >= (this.config.agentSessionAuthRateLimitMaxBuckets ?? 10_000);
  }

  private recordSessionFailure(key: string): void {
    const now = Date.now();
    const windowMs = this.config.agentSessionAuthRateLimitWindowMs ?? 60_000;
    const current = this.sessionFailureBuckets.get(key);
    if (!current && this.sessionFailureBuckets.size >= (this.config.agentSessionAuthRateLimitMaxBuckets ?? 10_000)) {
      return;
    }
    const bucket = current && now - current.windowStart < windowMs
      ? current
      : { windowStart: now, failures: 0 };
    bucket.failures += 1;
    this.sessionFailureBuckets.set(key, bucket);
  }

  private cleanupSessionFailureBuckets(now: number, windowMs: number): void {
    if (now - this.lastSessionFailureCleanupAt < windowMs) {
      return;
    }
    for (const [key, bucket] of this.sessionFailureBuckets) {
      if (now - bucket.windowStart >= windowMs) {
        this.sessionFailureBuckets.delete(key);
      }
    }
    this.lastSessionFailureCleanupAt = now;
  }

  private anyBearerAuthEnabled(): boolean {
    return this.publicReadMode() === 'bearer'
      || this.proposalMode() === 'bearer'
      || this.discoveryMode() === 'bearer';
  }

  private discoveryMode(): AgentAuthMode {
    return this.config.discoveryAuthMode ?? 'none';
  }

  private publicReadMode(): AgentAuthMode {
    return this.config.publicReadAuthMode ?? 'none';
  }

  private proposalMode(): AgentAuthMode {
    return this.config.proposalAuthMode ?? 'none';
  }

  private getAreaConfig(area: AgentAuthArea): AreaConfig {
    switch (area) {
      case 'discovery':
        return {
          mode: this.discoveryMode(),
          token: this.config.discoveryBearerToken ?? null,
          actor: this.config.discoveryBearerActor ?? 'agent-discovery-token',
        };
      case 'public-read':
        return {
          mode: this.publicReadMode(),
          token: this.config.publicReadBearerToken ?? null,
          actor: this.config.publicReadBearerActor ?? 'agent-read-token',
        };
      case 'proposal':
        return {
          mode: this.proposalMode(),
          token: this.config.proposalBearerToken ?? null,
          actor: this.config.proposalBearerActor ?? 'agent-proposal-token',
        };
    }
  }

  /**
   * Validates a raw bearer token against the configured token for an agent auth area.
   * Used by the agent-session creation flow where multiple area tokens are supplied
   * in separate headers.
   */
  validateAreaBearerToken(area: AgentAuthArea, token: string | undefined): boolean {
    const areaConfig = this.getAreaConfig(area);
    if (areaConfig.mode !== 'bearer' || !areaConfig.token || !token) {
      return false;
    }
    return constantTimeEquals(token, areaConfig.token);
  }

  /**
   * Throws the standard 401 error when an area bearer token is missing or invalid.
   */
  throwIfAreaBearerInvalid(area: AgentAuthArea, token: string | undefined): void {
    if (!this.validateAreaBearerToken(area, token)) {
      throw this.authRequired(area, 'bearer');
    }
  }

  private authRequired(
    area: AgentAuthArea,
    scheme: 'bearer' | 'oidc',
    options?: { missingAreas?: string[] }
  ): AgentAuthRequiredError {
    return new AgentAuthRequiredError(
      area,
      scheme,
      this.config.publicApiBaseUrl ? this.config.publicApiBaseUrl + '/discover' : '/discover',
      options?.missingAreas,
      this.agentSessionUrl()
    );
  }

  private agentSessionUrl(): string | undefined {
    if (!this.config.agentSessionEnabled || !this.anyBearerAuthEnabled()) {
      return undefined;
    }
    const apiBaseUrl = this.config.publicApiBaseUrl ?? 'http://localhost:3040';
    const defaultPort = Number(this.config.apiPort ?? 3040);
    const frontendPort = Number(process.env.FRONTEND_PORT ?? 3041);
    const frontendOrigin = defaultPort === frontendPort
      ? apiBaseUrl
      : apiBaseUrl.replace(/:(\d+)$/, ':' + frontendPort).replace(/\/api$/, '');
    return frontendOrigin + '/frontend/agent-auth';
  }

  private oidcScheme(areas: AgentAuthArea[], metadata: AgentOidcMetadata | null): OidcAgentAuthScheme {
    const issuer = metadata?.issuer ?? this.config.oidcAgentIssuer ?? '';
    const scopes = new Set(this.config.oidcAgentBaseScopes ?? []);
    if (areas.includes('discovery') && this.config.oidcDiscoveryScope) scopes.add(this.config.oidcDiscoveryScope);
    if (areas.includes('public-read') && this.config.oidcPublicReadScope) scopes.add(this.config.oidcPublicReadScope);
    if (areas.includes('proposal') && this.config.oidcProposalScope) scopes.add(this.config.oidcProposalScope);
    return {
      id: 'agent-oidc-device',
      type: 'oauth2',
      flow: 'device_code',
      issuer,
      scopes: Array.from(scopes),
      clientId: this.config.oidcAgentClientId ?? '',
      metadata: metadata
        ? {
            tokenEndpoint: metadata.tokenEndpoint,
            deviceAuthorizationEndpoint: metadata.deviceAuthorizationEndpoint,
          }
        : null,
      appliesTo: areas,
    };
  }
}

export function getAgentAuthContext(request: FastifyRequest): AgentAuthContext | null {
  return (request as FastifyRequest & { agentAuth?: AgentAuthContext }).agentAuth ?? null;
}

function readBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [scheme, ...rest] = value.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || rest.length !== 1) {
    return null;
  }
  return rest[0] || null;
}

function readAgentSessionCode(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [scheme, ...rest] = value.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'agentsession' || rest.length !== 1) {
    return null;
  }
  return rest[0]?.toUpperCase() || null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export interface AgentAuthScheme {
  id: string;
  type: 'bearer' | 'oauth2' | 'agent-session';
  appliesTo: AgentAuthArea[];
  instructions?: string;
  url?: string;
}

interface OidcAgentAuthScheme extends AgentAuthScheme {
  type: 'oauth2';
  flow: 'device_code';
  issuer: string;
  scopes: string[];
  clientId: string;
  metadata: {
    tokenEndpoint: string;
    deviceAuthorizationEndpoint: string;
  } | null;
}
