# Spec: AgentAuthPage

## Purpose

Provide a public, browser-based page where a human can create a short-lived
agent session by entering bearer tokens supplied by an administrator through a
separate trusted channel.

## Scope

- Route `/frontend/agent-auth`.
- Reading `/discover` to learn which areas require bearer tokens.
- Rendering token input fields only for bearer-enabled areas.
- Calling `POST /agent-sessions` with the appropriate `X-Agent-*-Token` headers.
- Displaying the returned session code with a copy-to-clipboard button.
- For authenticated admins, loading `/admin/agent-auth-config` and showing the
  configured bearer token values so they can be copied and shared.

## Non-Scope

- Admin session management; see `AdminAgentSessionsPage.spec.md`.
- Storing tokens or codes locally after the page is closed.
- OIDC Device Authorization flow.

## Responsibilities

- Load `/discover` on mount and detect the `agent-session` auth scheme.
- If the user is authenticated as an admin, also load `/admin/agent-auth-config`
  on mount.
- When admin tokens are available, render each configured bearer token in a
  read-only card with a copy-to-clipboard button and a warning about sharing
  through a trusted channel.
- When admin tokens are available, let the admin create a session by selecting
  one or more areas via checkboxes; the token values are taken from the config
  automatically and are not re-entered by hand.
- Show fields only for areas listed in `agent-session.appliesTo`.
- Send `X-Agent-Discovery-Token`, `X-Agent-Read-Token`, and/or
  `X-Agent-Proposal-Token` based on filled fields.
- Submit only non-empty tokens and the corresponding areas.
- Display errors from the API using `handleApiError`.
- Show the created code prominently, the granted areas, and the expiry time.
- Provide a copy-to-clipboard button with transient success feedback.
- Clear input fields after a successful creation.

## Inputs / Outputs

- Inputs: user-entered bearer tokens, `/discover` response.
- Outputs: `POST /agent-sessions` request, rendered code + instructions.

## Dependencies

- `agentSessionsApi.discover`
- `agentSessionsApi.createSession`
- `agentSessionsApi.getAdminAgentAuthConfig`
- `useAuthStore`
- `useLanguage`
- `handleApiError`

## Failure Modes

- `/discover` fails → error message.
- No bearer areas enabled → informational message.
- User submits without entering any token → inline error.
- Server rejects a token → API error message.
- Clipboard copy fails → silently ignored.
- Admin auth-config endpoint fails → error message shown, falls back to the
  non-admin input form.
- Admin token endpoint returns no tokens → falls back to the standard token
  input form.
