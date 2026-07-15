# Spec: MysqlAgentSessionRepository

## Purpose

Persist delegated agent sessions in the MySQL catalog projection so they
survive API restarts and remain visible to administrators in MySQL-backed
deployments.

## Scope

- MySQL catalog provider builds only.
- CRUD operations required by `AgentSessionRepositoryPort`.

## Non-Scope

- SQLite (see `SqliteAgentSessionRepository.spec.md`).
- Session validation logic; that belongs to the use case.

## Responsibilities

- Map the `AgentSession` domain object to and from the `agent_sessions` table.
- Backfill a random UUID `session_id` for legacy rows and use it for non-secret
  revocation.
- Store `areas` as a JSON array string.
- Convert `Date` values to ISO strings on write and back to `Date` on read.
- Treat `null` `revoked_at`/`last_used_at` as absent values.
- Support listing with optional expired/revoked filters and pagination.
- Count active sessions per originating IP for rate-limiting purposes.
- Revoke only sessions whose `revoked_at` is currently `NULL`.

## Schema

```sql
CREATE TABLE agent_sessions (
  session_id CHAR(36) NOT NULL UNIQUE,
  code VARCHAR(32) PRIMARY KEY,
  areas JSON NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  last_used_at DATETIME,
  created_by_ip VARCHAR(64),
  last_used_ip VARCHAR(64),
  user_agent TEXT
);
```

## Inputs / Outputs

- `create(session: AgentSession): Promise<void>`
- `findByCode(code): Promise<AgentSession | null>`
- `updateLastUsed(code, lastUsedAt, lastUsedIp): Promise<void>`
- `list({ includeExpired, includeRevoked, limit, offset }): Promise<AgentSession[]>`
- `revoke(sessionId, revokedAt): Promise<boolean>`
- `countActiveByIp(ip): Promise<number>`

## Failure Modes

- Duplicate code insert → MySQL primary-key violation propagates as storage error.
- Revoke of missing/already revoked session → returns `false`.

## Dependencies

- MySQL connection/client provided by the container.
- `AgentSessionRepositoryPort` contract.

## Notes

- Active queries use `expires_at > NOW()` and `revoked_at IS NULL`.
- JSON handling follows the existing MySQL catalog adapter patterns.
