# Spec: SqliteAgentSessionRepository

## Purpose

Persist delegated agent sessions in the SQLite catalog projection so they
survive API restarts and remain visible to administrators.

## Scope

- SQLite catalog provider builds only.
- CRUD operations required by `AgentSessionRepositoryPort`.

## Non-Scope

- MySQL (see `MysqlAgentSessionRepository.spec.md`).
- Session validation logic; that belongs to the use case.

## Responsibilities

- Map the `AgentSession` domain object to and from the `agent_sessions` table.
- Backfill a random UUID-shaped `session_id` for legacy rows and use it for
  non-secret revocation.
- Store `areas` as a JSON array string.
- Convert `Date` values to ISO strings on write and back to `Date` on read.
- Treat `null` `revoked_at`/`last_used_at` as absent values.
- Support listing with optional expired/revoked filters and pagination.
- Count active sessions per originating IP for rate-limiting purposes.
- Revoke only sessions whose `revoked_at` is currently `null`.

## Schema

```sql
CREATE TABLE agent_sessions (
  session_id TEXT NOT NULL UNIQUE,
  code VARCHAR(32) PRIMARY KEY,
  areas TEXT NOT NULL,
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

- Duplicate code insert → SQLite primary-key violation propagates as storage error.
- Revoke of missing/already revoked session → returns `false`.

## Dependencies

- `better-sqlite3` Database instance provided by the container.
- `AgentSessionRepositoryPort` contract.

## Notes

- Active queries use `expires_at > datetime('now')` and `revoked_at IS NULL`.
- JSON parsing of `areas` is performed inside the adapter, not in domain code.
