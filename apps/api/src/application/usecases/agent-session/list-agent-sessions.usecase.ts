import { AgentSession, AgentSessionRepositoryPort } from '../../ports/outbound/agent-session.port';

export interface ListAgentSessionsRequest {
  includeExpired?: boolean;
  includeRevoked?: boolean;
  limit?: number;
  offset?: number;
}

export class ListAgentSessionsUseCase {
  constructor(private readonly repository: AgentSessionRepositoryPort) {}

  async execute(request: ListAgentSessionsRequest = {}): Promise<AgentSession[]> {
    return this.repository.list({
      includeExpired: request.includeExpired ?? false,
      includeRevoked: request.includeRevoked ?? false,
      limit: request.limit ?? 100,
      offset: request.offset ?? 0,
    });
  }
}
