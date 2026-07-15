import { AgentSessionRepositoryPort } from '../../ports/outbound/agent-session.port';

export class RevokeAgentSessionUseCase {
  constructor(private readonly repository: AgentSessionRepositoryPort) {}

  async execute(sessionId: string): Promise<boolean> {
    return this.repository.revoke(sessionId, new Date());
  }
}
