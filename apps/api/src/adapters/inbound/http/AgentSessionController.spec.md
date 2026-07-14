# Spec: AgentSessionController (HTTP Adapter)

## Purpose

Expose browser-friendly, human-in-the-loop endpoints that let an agent session
code substitute for static bearer tokens on agent-facing routes, without
requiring the end user to download or execute a setup script.

## Scope

- `POST /agent-sessions` — public endpoint that creates a short-lived,
  area-scoped agent session after proving possession of the relevant bearer
  tokens.
- `GET /admin/agent-sessions` — admin-only list of sessions with sanitized
  metadata.
- `DELETE /admin/agent-sessions/:code` — admin-only revocation of a session.

## Non-Scope

- Admin session establishment (handled by `SimpleAdminAuth.spec.md` and
  `AdminOidcAuth.spec.md`).
- Long-lived credentials or user-account creation.
- OIDC Device Authorization flow; this remains the preferred flow when an
  Authentik tenant is configured.

## Responsibilities

- Accept requested areas in the request body (`discovery`, `public-read`,
  `proposal`).
- For every requested area, require the configured bearer token in a dedicated
  request header:
  - `X-Agent-Discovery-Token` for `discovery`
  - `X-Agent-Read-Token` for `public-read`
  - `X-Agent-Proposal-Token` for `proposal`
- Validate each area token against the configured bearer secret using the
  constant-time comparison logic in `AgentApiAuth`.
- Reject the request with `401` if any requested area token is missing,
  malformed, or wrong.
- Reject the request with `422` if the area list is empty or contains invalid
  values.
- Create exactly one session row and return an 8-character code, the granted
  areas, and the fixed expiry time.
- Log `agent_session_created` with the code, areas, and expiry, but never the
  bearer token values.
- Allow admins to list and revoke sessions; expose creation time, expiry,
  last-used time, IP addresses, and user agent, but never raw bearer values.

## Inputs / Outputs

### `POST /agent-sessions`

- Headers: `X-Agent-*-Token` for each requested area.
- Body: `{ areas: AgentSessionArea[] }`.
- Success `201`: `{ code: string, areas: AgentSessionArea[], expiresAt: string }`.
- Failure: normalized JSON error with `401` for missing/invalid area tokens or
  `422` for malformed input.

### `GET /admin/agent-sessions`

- Query: optional `includeExpired`, `includeRevoked`, `limit`, `offset`.
- Success `200`: `{ sessions: AgentSession[] }`.
- Failure: `401`/`403` for non-admin sessions.

### `DELETE /admin/agent-sessions/:code`

- Success `204`.
- Failure: `401`/`403` for non-admin sessions, `404` if the session is missing
  or already revoked.

### `GET /admin/agent-auth-config`

- Success `200`: `{ tokens: [{ area: AgentSessionArea, value: string }] }`.
- Failure: `401`/`403` for non-admin sessions.
- Only includes areas where the corresponding `*AuthMode` is `bearer` and the
  token is non-empty.

## Dependencies

- `AgentApiAuth` for per-area bearer-token validation.
- `CreateAgentSessionUseCase`, `ListAgentSessionsUseCase`,
  `RevokeAgentSessionUseCase`.
- `AgentSessionRepositoryPort` configured in the container.
- `AdminAuth` and `adminGuard` for management routes.

## Failure Modes

- Missing area header → `401` via `AgentAuthRequiredError`.
- Wrong area token → `401` via `AgentAuthRequiredError`.
- Requested area is not bearer-protected → `401` because no configured token
  exists.
- Empty or invalid area list → `422`.
- Admin list/revoke without admin role → `403`.
- Admin reads auth config without admin role → `403`.
- Non-bearer area or missing token omitted from `GET /admin/agent-auth-config`
  rather than returned as empty.

## Security Notes

- Bearer tokens are never echoed, logged, or stored inside the controller
  except on the dedicated admin-only `GET /admin/agent-auth-config` endpoint,
  which reads them directly from the runtime config.
- The admin-only endpoint is intended for out-of-band sharing with trusted users;
  it must not be exposed to agents or to non-admin sessions.
- A valid discovery token must not be sufficient to create a read or proposal
  session; each area is checked independently.
- Session codes are short-lived, single-purpose, and revocable by administrators.
- The controller does not set a session cookie for the agent; agents use the
  `Authorization: AgentSession <code>` header.
