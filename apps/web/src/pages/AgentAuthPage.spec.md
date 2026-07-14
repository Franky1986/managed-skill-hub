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

## Non-Scope

- Admin session management; see `AdminAgentSessionsPage.spec.md`.
- Storing tokens or codes locally after the page is closed.
- OIDC Device Authorization flow.

## Responsibilities

- Load `/discover` on mount and detect the `agent-session` auth scheme.
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
- `useLanguage`
- `handleApiError`

## Failure Modes

- `/discover` fails → error message.
- No bearer areas enabled → informational message.
- User submits without entering any token → inline error.
- Server rejects a token → API error message.
- Clipboard copy fails → silently ignored.
