import crypto from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AgentAuthMode, AppConfig } from '../../../infrastructure/config';
import { AgentAuthRequiredError } from '../../../domain/errors';

export type AgentAuthArea = 'discovery' | 'public-read' | 'proposal';

export interface AgentAuthContext {
  area: AgentAuthArea;
  actor: string;
  scheme: 'none' | 'bearer';
}

interface AreaConfig {
  mode: AgentAuthMode;
  token: string | null;
  actor: string;
}

export class AgentApiAuth {
  constructor(private readonly config: AppConfig) {}

  guard(area: AgentAuthArea) {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      const context = this.authenticate(area, request);
      (request as FastifyRequest & { agentAuth?: AgentAuthContext }).agentAuth = context;
    };
  }

  authenticate(area: AgentAuthArea, request: FastifyRequest): AgentAuthContext {
    const areaConfig = this.getAreaConfig(area);
    if (areaConfig.mode === 'none') {
      return { area, actor: 'anonymous-agent', scheme: 'none' };
    }

    const token = readBearerToken(request.headers.authorization);
    if (!token || !areaConfig.token || !constantTimeEquals(token, areaConfig.token)) {
      throw new AgentAuthRequiredError(
        area,
        'bearer',
        this.config.publicApiBaseUrl ? this.config.publicApiBaseUrl + '/discover' : '/discover',
        this.metadata().credentialSetupScriptUrl
      );
    }

    return { area, actor: areaConfig.actor, scheme: 'bearer' };
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
      credentialSetupScriptUrl: this.anyAgentAuthEnabled()
        ? (this.config.publicApiBaseUrl ?? 'http://localhost:3040') + '/agent-credentials/setup.sh'
        : undefined,
    };
  }

  private authSchemes(): Array<{ id: string; type: 'bearer'; appliesTo: AgentAuthArea[] }> {
    const schemes: Array<{ id: string; type: 'bearer'; appliesTo: AgentAuthArea[] }> = [];
    if (this.publicReadMode() === 'bearer') {
      schemes.push({ id: 'public-read-bearer', type: 'bearer', appliesTo: ['public-read'] });
    }
    if (this.proposalMode() === 'bearer') {
      schemes.push({ id: 'proposal-bearer', type: 'bearer', appliesTo: ['proposal'] });
    }
    if (this.discoveryMode() === 'bearer') {
      schemes.push({ id: 'discovery-bearer', type: 'bearer', appliesTo: ['discovery'] });
    }
    return schemes;
  }

  private anyAgentAuthEnabled(): boolean {
    return this.publicReadMode() !== 'none'
      || this.proposalMode() !== 'none'
      || this.discoveryMode() !== 'none';
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

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
