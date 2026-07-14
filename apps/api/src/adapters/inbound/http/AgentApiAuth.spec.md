# Spec: AgentApiAuth (HTTP Adapter)

## Purpose

Provide runtime-configurable authentication for agent-facing HTTP APIs without
changing domain or use-case logic.

## Scope

- Discovery/contract routes: `/discover`, `/howToPropose`, `/openapi.yaml`
- Public read routes: published skill list/search/detail/files/packages
- Proposal routes: duplicate check, submit, upload, finalize, notice, and status

## Non-Scope

- Admin session establishment and role mapping
- Provider-specific role interpretation in controllers
- OAuth/OIDC protocol implementation in domain or use-case code

## Behavior

- Supported selectors are `none`, `bearer`, and `oidc`.
- `none` never blocks a request and sets an anonymous agent context.
- `bearer` requires `Authorization: Bearer <token>`.
- The request context includes a provider-neutral principal. `none` creates an
  anonymous principal and static `bearer` creates a technical legacy principal.
- An OIDC-selected area fails closed until its access-token verifier succeeds;
  it is never interpreted as a static bearer mode.
- Successful OIDC authentication uses the verified stable principal ID as the
  actor and keeps the public client ID in the principal context.
- Token comparison uses constant-time comparison.
- Missing, malformed, or invalid bearer tokens produce normalized `401` errors
  with `details.authRequired`, `details.authArea`, `details.authScheme`,
  `details.discoverUrl`, and `details.credentialSetupScriptUrl`.
- Bearer tokens are never logged or returned in metadata.
- Proposal status follows `PROPOSAL_AUTH_MODE`; there is no separate status auth.
- When proposal bearer auth succeeds, the bearer actor is authoritative for
  proposal submit/upload/finalize instead of untrusted `X-Actor`.
- Open proposal mutations and package validation require the authoritative actor
  to match the proposal's recorded `submittedBy` actor. With the initial single
  static token this is primarily a future-compatible ownership boundary; true
  per-consumer isolation is provided by OIDC principal ownership.
- OIDC success and denial produce structured, redacted operational events with
  area and coarse category. Authorization headers and tokens are never logged.
- At public read route registration, a valid admin browser session with the
  `reader` or `admin` role is an explicit alternative to agent authentication.
  This route-level composition does not apply to discovery or proposals.

## Runtime Metadata

The adapter exposes non-secret metadata for discovery:

- `registryId`
- `registryName`
- `apiBaseUrl`
- `readAuthRequired`
- `proposalAuthRequired`
- `discoveryAuthRequired`
- `authSchemes`
- `credentialSetupScriptUrl`

`credentialSetupScriptUrl` is present only when at least one agent-facing area
uses static bearer auth. When `AGENT_SESSION_ENABLED=true`, the preferred human
entry point is the `agent-session` scheme URL; the setup script remains a
fallback for clients that want to store long-lived credentials locally. OIDC metadata includes the trusted issuer, public
client ID, OpenID configuration URL, Device Authorization and token endpoints,
scopes, and applicable areas, never a client secret.

## Guardrails

- Keep auth in the inbound HTTP adapter layer.
- Keep credential authentication in the inbound adapter. Submitter ownership is
  an application authorization invariant and must not be implemented in HTTP
  controllers.
- Do not let agent bearer tokens grant admin privileges.
- Do not print or persist bearer tokens in logs, responses, generated scripts, or
  proposal artifacts.

## Agent Session Delegation

When `AGENT_SESSION_ENABLED=true` and at least one agent-facing area uses
`bearer`, the adapter:

- Advertises an `agent-session` scheme in `/discover` `authSchemes` covering the
  bearer-enabled areas. The scheme includes an absolute `url` pointing to
  `/frontend/agent-auth` and `instructions` that tell the agent to present that
  link to the user. When the public API base URL includes a different port than
  the frontend port, the URL is rewritten to the frontend origin so the link
  opens the human-facing UI instead of the API backend. The instructions
  explicitly invite agents with an in-app browser or browser MCP to open the
  page directly and notify the user that the auth page is ready.
- Accepts `Authorization: AgentSession <code>` on protected agent routes after
  bearer validation fails.
- Validates the code through `ValidateAgentSessionUseCase` for the requested
  area only.
- Creates a `session`-scheme principal for the request context when validation
  succeeds.
- Falls back to the standard `401` response when no valid bearer or session is
  present.

### Session Creation Validation

`AgentApiAuth` exposes helper methods for the controller:

- `validateAreaBearerToken(area, token)` performs a constant-time comparison of
  the supplied token against the configured bearer token for that area.
- `throwIfAreaBearerInvalid(area, token)` throws the normalized `401` when the
  token is missing or invalid.

These helpers allow `POST /agent-sessions` to require a separate bearer token for
each requested area (via `X-Agent-*-Token` headers) without reinterpreting the
single `Authorization` header.
