# Spec: Agent Session Use Cases

## Purpose

Encapsulate the lifecycle of a delegated agent session: creation, validation,
listing, and revocation.

## Scope

- `CreateAgentSessionUseCase`
- `ValidateAgentSessionUseCase`
- `ListAgentSessionsUseCase`
- `RevokeAgentSessionUseCase`

## Non-Scope

- HTTP transport details (headers, cookies, status codes).
- Bearer-token comparison; that belongs to `AgentApiAuth`.
- Admin authentication; that belongs to admin auth adapters.

## Responsibilities

### CreateAgentSessionUseCase

- Filter requested areas against the areas currently protected by bearer auth in
  the runtime configuration.
- Throw if no enabled area remains after filtering.
- Enforce `AGENT_SESSION_MAX_ACTIVE` by counting active sessions for the
  originating IP against the repository.
- Generate a code from the configured charset and length using a cryptographic
  random source.
- Compute a fixed expiry as `now + AGENT_SESSION_TTL_SECONDS`.
- Persist the session through `AgentSessionRepositoryPort.create`.
- Return the code, granted areas, and expiry.

### ValidateAgentSessionUseCase

- Look up the session by code.
- Fail closed if the session is missing, revoked, expired, or does not cover the
  requested area.
- Update `lastUsedAt` and `lastUsedIp` on every successful validation.
- Return the validated code and its granted areas so callers can build the auth
  context.

### ListAgentSessionsUseCase

- Pass filter flags and pagination to the repository.
- Return the list of `AgentSession` domain objects unchanged.

### RevokeAgentSessionUseCase

- Call `repository.revoke(code, now)`.
- Return whether the revocation changed an active session.

## Inputs / Outputs

- `CreateAgentSessionRequest`: `{ areas, createdByIp, userAgent }`
- `CreateAgentSessionResult`: `{ code, areas, expiresAt }`
- `ValidateAgentSessionRequest`: `{ code, area, usedByIp }`
- `ValidateAgentSessionResult`: `{ valid, code?, areas? }`
- `ListAgentSessionsRequest`: `{ includeExpired?, includeRevoked?, limit?, offset? }`

## Dependencies

- `AgentSessionRepositoryPort`
- `AppConfig` for TTL, code length, charset, max active, and enabled auth modes.
- `crypto.randomBytes` for code generation.

## Failure Modes

- No enabled area requested → throws generic `Error` mapped to `422` by the
  controller.
- Active session limit reached → throws generic `Error` mapped to `429` by the
  controller.
- Missing/expired/revoked code → validation returns `valid: false`.
- Area not covered by session → validation returns `valid: false`.

## Invariants

- A session never grants more areas than were requested and validated by the
  controller.
- Code generation uses the full configured charset uniformly.
- Expiry is computed once at creation time and never extended by validation.
