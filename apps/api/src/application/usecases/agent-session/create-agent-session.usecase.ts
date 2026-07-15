import crypto from 'node:crypto';
import {
  AgentSession,
  AgentSessionArea,
  AgentSessionRepositoryPort,
} from '../../ports/outbound/agent-session.port';
import { AppConfig } from '../../../infrastructure/config';

export interface CreateAgentSessionRequest {
  areas: AgentSessionArea[];
  createdByIp: string | null;
  userAgent: string | null;
}

export interface CreateAgentSessionResult {
  sessionId: string;
  code: string;
  areas: AgentSessionArea[];
  expiresAt: Date;
}

export class CreateAgentSessionUseCase {
  constructor(
    private readonly repository: AgentSessionRepositoryPort,
    private readonly config: AppConfig
  ) {}

  async execute(request: CreateAgentSessionRequest): Promise<CreateAgentSessionResult> {
    const enabledAreas = this.enabledAreas();
    const areas = request.areas.filter((area) => enabledAreas.includes(area));
    if (areas.length === 0) {
      throw new Error('No enabled agent auth area requested.');
    }

    if (this.config.agentSessionMaxActive !== null) {
      const activeCount = await this.repository.countActiveByIp(request.createdByIp ?? 'unknown');
      if (activeCount >= this.config.agentSessionMaxActive) {
        throw new Error('Active agent session limit reached for this origin.');
      }
    }

    const code = this.generateCode();
    const now = new Date();
    const ttlMs = this.config.agentSessionTtlSeconds * 1000;
    const session: AgentSession = {
      id: crypto.randomUUID(),
      code,
      areas,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      revokedAt: null,
      lastUsedAt: null,
      createdByIp: request.createdByIp,
      lastUsedIp: null,
      userAgent: request.userAgent,
    };
    await this.repository.create(session);
    return { sessionId: session.id, code, areas, expiresAt: session.expiresAt };
  }

  private enabledAreas(): AgentSessionArea[] {
    const areas: AgentSessionArea[] = [];
    if (this.config.discoveryAuthMode === 'bearer') areas.push('discovery');
    if (this.config.publicReadAuthMode === 'bearer') areas.push('public-read');
    if (this.config.proposalAuthMode === 'bearer') areas.push('proposal');
    return areas;
  }

  private generateCode(): string {
    const charset = this.config.agentSessionCodeCharset;
    const length = this.config.agentSessionCodeLength;
    let code = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      code += charset[bytes[i] % charset.length];
    }
    return code;
  }
}
