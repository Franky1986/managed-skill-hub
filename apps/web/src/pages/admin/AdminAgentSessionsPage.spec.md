# Spec: AdminAgentSessionsPage

## Purpose

Allow administrators to inspect active, expired, and revoked agent sessions and
to revoke active sessions immediately.

## Scope

- Route `/frontend/admin/agent-sessions` (admin-only).
- Listing sessions from `GET /admin/agent-sessions`.
- Background polling every 10 seconds.
- Revocation through `DELETE /admin/agent-sessions/:code`.

## Non-Scope

- Creating sessions; see `AgentAuthPage.spec.md`.
- Viewing raw bearer token values.

## Responsibilities

- Fetch the session list on mount and refresh it in the background.
- Display each session's code, areas, status (active/expired/revoked), creation
  time, expiry, last-used time, and originating IP/user agent.
- Offer a Revoke button only for active sessions.
- Update the local list after successful revocation.
- Show API errors using `handleApiError`.

## Inputs / Outputs

- Inputs: `GET /admin/agent-sessions` response.
- Outputs: rendered list, `DELETE /admin/agent-sessions/:code` calls.

## Dependencies

- `agentSessionsApi.listSessions`
- `agentSessionsApi.revokeSession`
- `useLanguage`
- `useBackgroundPolling`
- `formatLocalDateTime`

## Failure Modes

- Session check fails → handled by `AdminRoute`.
- List fetch fails → error message.
- Revocation fails → error message; list remains unchanged.
