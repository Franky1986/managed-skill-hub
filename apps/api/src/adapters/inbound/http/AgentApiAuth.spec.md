# Spec: AgentApiAuth (HTTP Adapter)

## Purpose

Provide runtime-configurable authentication for agent-facing HTTP APIs without
changing domain or use-case logic.

## Scope

- Discovery/contract routes: `/discover`, `/howToPropose`, `/openapi.yaml`
- Public read routes: published skill list/search/detail/files/packages
- Proposal routes: duplicate check, submit, upload, finalize, notice, and status

## Non-Scope

- Admin session authentication
- Full RBAC or multi-tenant token management
- OAuth/OIDC validation inside the application
- Per-user proposal accounts

## Behavior

- Supported modes are `none` and `bearer`.
- `none` never blocks a request and sets an anonymous agent context.
- `bearer` requires `Authorization: Bearer <token>`.
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
  per-consumer isolation requires the planned multi-token/OIDC phase.

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

`credentialSetupScriptUrl` is present only when at least one agent-facing auth
mode is enabled.

## Guardrails

- Keep auth in the inbound HTTP adapter layer.
- Keep credential authentication in the inbound adapter. Submitter ownership is
  an application authorization invariant and must not be implemented in HTTP
  controllers.
- Do not let agent bearer tokens grant admin privileges.
- Do not print or persist bearer tokens in logs, responses, generated scripts, or
  proposal artifacts.
