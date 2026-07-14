export type AgentSessionArea = 'discovery' | 'public-read' | 'proposal';

export interface AgentSession {
  code: string;
  areas: AgentSessionArea[];
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdByIp: string | null;
  lastUsedIp: string | null;
  userAgent: string | null;
}

export interface CreateAgentSessionInput {
  areas: AgentSessionArea[];
  ttlSeconds: number;
  createdByIp: string | null;
  userAgent: string | null;
}

export interface AgentSessionRepositoryPort {
  create(session: AgentSession): Promise<void>;
  findByCode(code: string): Promise<AgentSession | null>;
  updateLastUsed(code: string, lastUsedAt: Date, lastUsedIp: string | null): Promise<void>;
  list(options?: { includeExpired?: boolean; includeRevoked?: boolean; limit?: number; offset?: number }): Promise<AgentSession[]>;
  revoke(code: string, revokedAt: Date): Promise<boolean>;
  countActiveByIp(ip: string): Promise<number>;
}
