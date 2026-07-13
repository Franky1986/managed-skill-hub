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
uses static bearer auth. OIDC metadata includes the trusted issuer, public
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
