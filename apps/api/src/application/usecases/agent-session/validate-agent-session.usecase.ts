import {
  AgentSessionArea,
  AgentSessionRepositoryPort,
} from '../../ports/outbound/agent-session.port';

export interface ValidateAgentSessionRequest {
  code: string;
  area: AgentSessionArea;
  usedByIp: string | null;
}

export interface ValidateAgentSessionResult {
  valid: boolean;
  code?: string;
  areas?: AgentSessionArea[];
  reason?: 'not_found' | 'revoked' | 'expired' | 'area_not_allowed';
  sessionAreas?: AgentSessionArea[];
}

export class ValidateAgentSessionUseCase {
  constructor(private readonly repository: AgentSessionRepositoryPort) {}

  async execute(request: ValidateAgentSessionRequest): Promise<ValidateAgentSessionResult> {
    const session = await this.repository.findByCode(request.code);
    if (!session) {
      return { valid: false, reason: 'not_found' };
    }
    if (session.revokedAt !== null) {
      return { valid: false, reason: 'revoked' };
    }
    if (session.expiresAt.getTime() < Date.now()) {
      return { valid: false, reason: 'expired' };
    }
    if (!session.areas.includes(request.area)) {
      return { valid: false, reason: 'area_not_allowed', sessionAreas: session.areas };
    }
    await this.repository.updateLastUsed(request.code, new Date(), request.usedByIp);
    return { valid: true, code: session.code, areas: session.areas };
  }
}
