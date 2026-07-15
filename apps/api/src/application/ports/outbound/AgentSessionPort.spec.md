# Spec: AgentSessionRepositoryPort (Outbound Port)

## Purpose

Define the repository contract for delegated agent sessions so the domain and
use cases remain independent of SQLite/MySQL specifics.

## Scope

- Create, read, update-last-used, list, revoke, and count operations for agent
  sessions.

## Non-Scope

- Bearer-token validation.
- HTTP or UI concerns.

## Contract

```typescript
export type AgentSessionArea = 'discovery' | 'public-read' | 'proposal';

export interface AgentSession {
  id: string;
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

export interface AgentSessionRepositoryPort {
  create(session: AgentSession): Promise<void>;
  findByCode(code: string): Promise<AgentSession | null>;
  updateLastUsed(code: string, lastUsedAt: Date, lastUsedIp: string | null): Promise<void>;
  list(options?: { includeExpired?: boolean; includeRevoked?: boolean; limit?: number; offset?: number }): Promise<AgentSession[]>;
  revoke(sessionId: string, revokedAt: Date): Promise<boolean>;
  countActiveByIp(ip: string): Promise<number>;
}
```

## Responsibilities

- Adapters implement the contract with provider-specific SQL/connection logic.
- Use cases depend only on the port, never on adapter details.

## Invariants

- `id` is a random, non-secret administrative and attribution identifier.
- `code` is the authentication credential and must not be used in logs, actor
  identifiers, audit attribution, or URLs.
- `areas` is a non-empty array of valid `AgentSessionArea` values.
- `expiresAt` is always greater than `createdAt`.
- Adapters must not mutate the domain object unexpectedly.
