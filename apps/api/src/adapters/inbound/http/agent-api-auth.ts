import crypto from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AgentAuthMode, AppConfig } from '../../../infrastructure/config';
import { AgentAuthRequiredError } from '../../../domain/errors';
import {
  anonymousAgentPrincipal,
  AuthenticatedPrincipal,
  staticBearerPrincipal,
} from '../../../application/security/authenticated-principal';
import { AccessTokenVerifierPort, AgentOidcMetadata } from '../../../application/ports/outbound/access-token-verifier.port';

export type AgentAuthArea = 'discovery' | 'public-read' | 'proposal';

export interface AgentAuthContext {
  area: AgentAuthArea;
  actor: string;
  scheme: 'none' | 'bearer' | 'oidc';
  principal: AuthenticatedPrincipal;
}

interface AreaConfig {
  mode: AgentAuthMode;
  token: string | null;
  actor: string;
}

export class AgentApiAuth {
  constructor(
    private readonly config: AppConfig,
    private readonly tokenVerifier?: AccessTokenVerifierPort
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
    if (!token || !areaConfig.token || !constantTimeEquals(token, areaConfig.token)) {
      throw this.authRequired(area, 'bearer');
    }

    return {
      area,
      actor: areaConfig.actor,
      scheme: 'bearer',
      principal: staticBearerPrincipal(areaConfig.actor),
    };
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
      credentialSetupScriptUrl: this.anyBearerAuthEnabled()
        ? (this.config.publicApiBaseUrl ?? 'http://localhost:3040') + '/agent-credentials/setup.sh'
        : undefined,
    };
  }

  private authSchemes(): AgentAuthScheme[] {
    const schemes: AgentAuthScheme[] = [];
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

  private authRequired(area: AgentAuthArea, scheme: 'bearer' | 'oidc'): AgentAuthRequiredError {
    return new AgentAuthRequiredError(
      area,
      scheme,
      this.config.publicApiBaseUrl ? this.config.publicApiBaseUrl + '/discover' : '/discover',
      scheme === 'bearer' ? this.metadata().credentialSetupScriptUrl : undefined
    );
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
      openIdConfigurationUrl: metadata?.openIdConfigurationUrl
        ?? `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
      authorizationEndpoint: metadata?.authorizationEndpoint,
      deviceAuthorizationEndpoint: metadata?.deviceAuthorizationEndpoint,
      tokenEndpoint: metadata?.tokenEndpoint,
      clientId: metadata?.clientId ?? this.config.oidcAgentClientId ?? '',
      scopes: [...scopes],
      appliesTo: areas,
    };
  }
}

type BearerAgentAuthScheme = { id: string; type: 'bearer'; appliesTo: AgentAuthArea[] };
type OidcAgentAuthScheme = {
  id: string;
  type: 'oauth2';
  flow: 'device_code';
  issuer: string;
  openIdConfigurationUrl: string;
  authorizationEndpoint?: string;
  deviceAuthorizationEndpoint?: string;
  tokenEndpoint?: string;
  clientId: string;
  scopes: string[];
  appliesTo: AgentAuthArea[];
};
type AgentAuthScheme = BearerAgentAuthScheme | OidcAgentAuthScheme;

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

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
