# EPIC-012: Agent Session Delegation

## Status

Planned.

## Objective

Provide a browser-based, human-in-the-loop mechanism for authorizing agents to
act on a ManagedSkillHub registry without requiring the agent or the end user
to download or execute a setup script.

When an agent needs to call a protected public-read or proposal endpoint, the
human opens a registry page in the browser, enters the bearer token that an
administrator has supplied through a separate channel, and receives a short,
ephemeral agent-session code. The human pastes that code into the agent chat.
The agent then sends it as an `Authorization: AgentSession <code>` header on
subsequent requests. The session is stored in the configured relational
database, scoped to the enabled areas, and can be inspected and revoked by
administrators.

## Why This Epic Exists

The existing bearer-only flow requires the user to download and run a shell
agent-session URL (`/frontend/agent-auth`) and enter tokens into a browser form. For
many users this feels suspicious and is operationally inconvenient. It also
prevents the agent from driving the workflow in a single conversation: the human
must leave the chat, run a script, and return.

Agent session delegation keeps the human in control, avoids executable scripts,
and lets the agent continue after the human has performed a short browser
step. It reuses the existing static bearer configuration on the server side
while adding a secure, auditable, human-delegated session layer for agents.

## Non-Goals

- It is not a replacement for OIDC Device Authorization. When an Authentik
  tenant is available, the Device Authorization linkout remains the preferred
  per-human identity flow.
- It is not a full user-account system for agents. Sessions are short-lived
  and area-scoped; they do not create local user rows or long-lived credentials.
- It does not relax the requirement that only published skills are served
  through public read endpoints.
- It does not grant admin capabilities. Agent sessions may only authorize
  agent-facing public-read and proposal routes, never admin mutation routes.

## Configuration

All new behavior is driven by standard environment variables. No new secret
keys are introduced.

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_READ_AUTH_MODE` | no | Must be `bearer` for read delegation to be meaningful. |
| `PROPOSAL_AUTH_MODE` | no | Must be `bearer` for proposal delegation to be meaningful. |
| `PUBLIC_READ_BEARER_TOKEN` | when read bearer | Server-side read token provided by the operator/admin. |
| `PROPOSAL_BEARER_TOKEN` | when proposal bearer | Server-side proposal token provided by the operator/admin. |
| `AGENT_SESSION_TTL_SECONDS` | no | Default lifetime for a new agent session. Default: `10800` (3 hours). |
| `AGENT_SESSION_ENABLED` | no | Feature toggle. Default: `true`. Set to `false` to disable agent sessions. |
| `AGENT_SESSION_CODE_CHARSET` | no | URL-safe, case-insensitive alphabet for codes. Default: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. |
| `AGENT_SESSION_CODE_LENGTH` | no | Number of characters in a code. Default: `8`. |
| `AGENT_SESSION_MAX_ACTIVE` | no | Optional per-IP cap on active sessions to limit abuse. Default: `10`. |

The operator places bearer token values in `.env.secrets` or a deployment secret
manager. The human receives the token value through a separate, trusted channel
(email, password manager, internal wiki, admin handoff).

## Design Decisions

The following decisions were taken to keep the flow simple, secure, and
consistent with the existing auth boundary:

1. **Agent transport is an `Authorization` header.** The agent uses
   `Authorization: AgentSession <code>`. This is easy for agents to construct,
   distinct from bearer, and does not require cookie-jar handling in CLI
   agents. A browser convenience cookie may be set on `/frontend/agent-auth`
   for the page itself, but it is **not** the canonical agent credential.
2. **Session management is admin-only.** Only users with the `admin` role may
   list or revoke agent sessions. Reviewers and publishers have no management
   rights; their role is limited to proposal/skill review and publication.
3. **The code is displayed as text in the browser.** After token validation,
   `/frontend/agent-auth` shows the 8-character code prominently with a
   copy-to-clipboard button. No session cookie is required for the agent.
4. **Sessions have a fixed expiry.** The lifetime is computed at creation time
   and is not extended by use. This keeps the security surface small and
   predictable. A future enhancement may add an explicit sliding-window mode.
5. **Areas are strictly separated.** Entering a proposal token creates proposal
   authority only. Entering a read token creates read authority only. A session
   can cover both if the human provides both tokens, but one token never
   implicitly grants the other area.
6. **`/frontend/agent-auth` is publicly reachable without admin login.** Anyone
   who knows a valid area bearer token can create a session for that area. The
   page is unauthenticated because the bearer token itself is the proof of
   authority, supplied through a trusted out-of-band channel.

## Authentication Model

The existing agent authentication boundary (`AgentApiAuth`) is extended with
an additional scheme that is checked **after** bearer validation:

1. If a valid bearer token for the requested area is present, use it and its
   configured actor, exactly as today.
2. If no valid bearer token is present, look for `Authorization: AgentSession
   <code>` and validate the code against the `agent_sessions` table.
3. If the code exists, is not revoked, has not expired, and covers the
   requested area, treat the request as authenticated for that area only.
4. Otherwise return the existing normalized `401 AgentAuthRequiredError`
   response for the area.

Cross-area isolation is preserved: a session created with only the read area
enabled cannot access proposal routes, and vice versa.

## Session Lifecycle

### Create

A human creates a session through the browser:

1. Open `GET /frontend/agent-auth`.
2. The page shows input fields only for the areas currently protected by a
   bearer token. For example, if both `PUBLIC_READ_AUTH_MODE=bearer` and
   `PROPOSAL_AUTH_MODE=bearer` are set, two fields appear: “Read bearer token”
   and “Proposal bearer token”. The human may fill one or both.
3. The page calls `POST /agent-sessions` with the requested areas and the
   corresponding area bearer tokens in dedicated request headers
   (`X-Agent-Read-Token`, `X-Agent-Proposal-Token`, `X-Agent-Discovery-Token`).
   The server validates every supplied token against its configured bearer
   secret before creating the session.
5. The server creates one session row and returns an 8-character code such as
   `A3B7K9P2`.
6. The page displays the code prominently, offers a copy-to-clipboard button,
   and explains: “Give this code to your agent. It is valid for 3 hours and
   can be used for the enabled areas.”

### Use

The agent receives the code in chat and uses it on every protected request:

```bash
curl -H "Authorization: AgentSession A3B7K9P2" http://localhost:3040/skills
```

The header is intentionally distinct from `Bearer` so that existing bearer
logic does not need to be reinterpreted and so that audit logs can distinguish
a delegated session from a configured bearer token.

### Expiry

Sessions expire at a fixed time computed during creation. The default is
3 hours (`AGENT_SESSION_TTL_SECONDS=10800`). A session is not extended by use.

### Revocation

Administrators can list and revoke sessions:

- `GET /admin/agent-sessions` lists active and recently expired/revoked sessions
  with creation time, enabled areas, expiry, last-used time, and a revocation
  flag. It intentionally does not expose raw token values or user identities.
- `DELETE /admin/agent-sessions/:code` immediately revokes the session.
- Revoked and expired sessions are retained for a bounded period (default 7
  days) to support audit queries, then removed by a periodic cleanup task or
  projection maintenance.

## Storage

Sessions are stored in the configured relational catalog database so that they
survive API restarts and are visible to administrators regardless of which
API process created them.

Proposed table (SQLite/MySQL compatible):

```sql
CREATE TABLE agent_sessions (
  code VARCHAR(16) PRIMARY KEY,
  areas TEXT NOT NULL,              -- JSON array, e.g. ["public-read","proposal"]
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  last_used_at DATETIME,
  created_by_ip VARCHAR(64),
  last_used_ip VARCHAR(64),
  user_agent TEXT
);
```

The code is the only public identifier. It is generated from a 32-character
alphabet with 8 characters, giving ~48 bits of entropy. This is sufficient for
short-lived, rate-limited, human-in-the-loop codes.

## API Extensions

### Public/agent routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/agent-sessions` | Area bearer tokens in `X-Agent-*-Token` headers | Create a new agent session and return the code. |
| `GET` | `/discover` | none / bearer / session | Extended to advertise `agentSession` support when enabled. |

### Admin routes

| Method | Path | Admin Role | Description |
|---|---|---|---|
| `GET` | `/admin/agent-sessions` | `admin` | List sessions with sanitized metadata. |
| `DELETE` | `/admin/agent-sessions/:code` | `admin` | Revoke a session immediately. |

## UI Extensions

### `/frontend/agent-auth`

A new public (unauthenticated) page that:

- Reads `/discover` to learn which areas require bearer tokens.
- Renders token input fields only for the areas that are configured.
- Validates each token silently against the API.
- Creates the session and displays the resulting code.
- Provides copy-to-clipboard and brief usage instructions.

### `/frontend/admin/agent-sessions`

A new admin page linked from the existing admin dashboard that:

- Lists active sessions with area badges, creation time, expiry, and last use.
- Offers a “Revoke” action with confirmation.
- Refreshes in the background using the existing polling hook.

## Security Considerations

- Bearer tokens are never displayed by the registry UI. The human enters them
  from an out-of-band channel, and the page only reports which areas validated
  successfully.
- Agent session codes are short-lived, area-scoped, and single-purpose. They
  are not passwords and must not be reused for other services.
- Brute force is mitigated by the code space, short lifetime, and existing
  per-IP rate limits. A per-code rate limit may be added later if operational
  data shows it is needed.
- Session lookup follows the configured catalog provider. In mixed-provider
  setups, sessions are available wherever the catalog projection is active.
- Session creation is logged with `event: agent_session_created`, including
  areas and expiry but never the bearer token values. Tokens are transmitted in
  dedicated request headers and compared in constant time. Usage is logged with
  `event: agent_session_used`. Revocation is logged with
  `event: agent_session_revoked`.
- Revoked or expired sessions fail closed.

## Dependency Order

1. Database table and catalog adapter extension.
2. Domain object and use cases for create, validate, list, revoke.
3. Extension of `AgentApiAuth` to accept `AgentSession`.
4. HTTP controller and OpenAPI updates.
5. React pages for agent-auth and admin session management.
6. Deterministic tests, co-located specs, and progress-document updates.

## Definition Of Done

- Co-located specs exist for the new ports, use cases, controllers, and UI
  pages.
- Unit and integration tests cover create, validation, expiry, revocation,
  cross-area isolation, and audit logging.
- The discover endpoint advertises the new scheme when enabled.
- `./scripts/check.sh` passes.
- `CURRENT_STATUS.md`, `NEXT_STEPS.md`, and `CHANGELOG_INTERNAL.md` are updated.
