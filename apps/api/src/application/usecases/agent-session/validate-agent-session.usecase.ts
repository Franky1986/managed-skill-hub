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
}

export class ValidateAgentSessionUseCase {
  constructor(private readonly repository: AgentSessionRepositoryPort) {}

  async execute(request: ValidateAgentSessionRequest): Promise<ValidateAgentSessionResult> {
    const session = await this.repository.findByCode(request.code);
    if (!session) {
      return { valid: false };
    }
    if (session.revokedAt !== null) {
      return { valid: false };
    }
    if (session.expiresAt.getTime() < Date.now()) {
      return { valid: false };
    }
    if (!session.areas.includes(request.area)) {
      return { valid: false };
    }
    await this.repository.updateLastUsed(request.code, new Date(), request.usedByIp);
    return { valid: true, code: session.code, areas: session.areas };
  }
}
