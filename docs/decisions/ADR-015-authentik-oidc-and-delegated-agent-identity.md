# ADR-015: Authentik OIDC And Delegated Agent Identity

## Status

Implemented. Production activation remains conditional on the real Authentik
staging gate for the target deployment.

## Context

ManagedSkillHub retains one local admin compatibility mode and independently
configurable `none` or static `bearer` authentication for discovery, published
skill reads, and proposal operations. This decision adds OIDC because a shared
bearer actor cannot identify the human who instructed an agent to submit a
proposal.

The existing authentik installation already owns the user population. Agents
must be able to ask a human to authenticate by presenting a clickable link in
the conversation. ManagedSkillHub must not collect authentik credentials or
place OAuth tokens in browser storage or agent conversations.

## Decision

### Independent authentication modes

Keep authentication independently configurable per boundary:

- `ADMIN_AUTH_MODE=simple|oidc`
- `DISCOVERY_AUTH_MODE=none|bearer|oidc`
- `PUBLIC_READ_AUTH_MODE=none|bearer|oidc`
- `PROPOSAL_AUTH_MODE=none|bearer|oidc`

`DISCOVERY_AUTH_MODE=none` remains the recommended OIDC deployment default so
agents can discover the issuer, public client ID, scopes, and Device
Authorization endpoint before they hold credentials.

### Existing authentik users and just-in-time principals

Authentik remains the user system of record. ManagedSkillHub does not import or
store passwords and does not require a pre-provisioned local user row.

On the first valid OIDC login, ManagedSkillHub creates or refreshes a local
principal projection containing a stable subject reference and mutable display
attributes. Both ManagedSkillHub authentik providers use authentik `user_uuid`
as their subject mode. The application may correlate subjects across only the
explicitly configured admin and agent issuers from the same trusted authentik
tenant.

Email address, username, and display name are mutable attributes and must not be
used as ownership or admin authorization keys.

### Delegated agent proposal flow

Agents use OAuth 2.0 Device Authorization Grant against a public authentik
client:

1. The agent obtains OIDC metadata from ManagedSkillHub discovery.
2. The agent starts the device flow with the public client ID and explicit
   scopes.
3. The agent shows the human only `verification_uri_complete` and, optionally,
   `user_code`.
4. The agent keeps `device_code` secret and polls at the server-provided
   interval.
5. After the human authenticates and authorizes the request, the agent receives
   a short-lived access token.
6. ManagedSkillHub validates the access token and records both the human
   principal and the authorized agent client where available.

The first implementation does not request `offline_access`. Expired access
requires a new human linkout. Tokens must not be printed in chat, persisted in
proposal artifacts, stored in browser `localStorage`, or written to normal
application logs.

### Proposal access policy

OIDC proposal access supports two policies:

- `all_authenticated_users`: every active, interactive human accepted by the
  configured authentik application can submit proposals and read proposal
  status by UUID.
- `required_groups`: proposal submit/read access requires membership in one of
  the configured `managedskillhub-*` groups.

`all_authenticated_users` is the initial target default. Authentik application
policy must reject service accounts for this flow because proposals are
submitted by agents on behalf of humans.

Proposal creation, file changes, metadata changes, validation, finalization,
and deletion remain owner-bound to the stable human principal. Any
OIDC-authenticated proposal user may read a status resource when they already
know its UUID; this does not create a proposal listing capability.

Non-admin proposal status responses must not expose email addresses, internal
principal IDs, audit records, or another proposal's UUID. Admin and reviewer
views may resolve the principal to current display information.

### Groups and administrative bootstrap

Authentik groups use the `managedskillhub-` prefix:

- `managedskillhub-users`
- `managedskillhub-readers`
- `managedskillhub-submitters`
- `managedskillhub-reviewers`
- `managedskillhub-publishers`
- `managedskillhub-admins`

Initial administrators may be bootstrapped with stable authentik subject UUIDs
from `OIDC_ADMIN_SUBJECTS`. Normal ongoing administration uses
`OIDC_ADMIN_GROUPS=managedskillhub-admins`. Subject and group grants are
additive. Username and email allowlists are not supported for privileged roles.

When `ADMIN_AUTH_MODE=oidc`, the local username/password endpoint is disabled
and `ADMIN_USER`, `ADMIN_PASSWORD`, and `ADMIN_PASSWORD_HASH` are not required.
Simple auth remains available for local development through
`ADMIN_AUTH_MODE=simple`. No implicit password fallback is active in OIDC mode.

### Separate authentik clients

Use two authentik OAuth2/OIDC providers:

- `managedskillhub-admin-web`: confidential Authorization Code client with
  PKCE and exact callback URIs.
- `managedskillhub-agent-device`: public Device Authorization client without a
  client secret.

Both providers use asymmetric signing, short access-token lifetimes, explicit
scopes, and `user_uuid` subject mode. The API validates exact issuer, audience,
signature algorithm, signature, expiry, not-before time, scopes, and client
identity. RFC 9068 access tokens require `typ=at+jwt`. Authentik `typ=JWT`
access tokens are accepted only when a separate confidential checker confirms
active-token, client, and subject values through authenticated introspection.
JWKS rotation is supported and validation fails closed.

The admin browser receives only a ManagedSkillHub `HttpOnly`, `Secure` session
cookie. OAuth state, nonce, and PKCE verifier are generated cryptographically
and handled server-side. The temporary callback transaction may use
`SameSite=Lax`; the established admin session should use `SameSite=Strict` when
deployment topology permits it.

## Consequences

- Existing authentik users can use ManagedSkillHub without account import.
- Proposal audit and ownership can identify the authorizing human instead of a
  shared token label.
- Operators can keep skills public while requiring OIDC for proposals, or
  protect each API area independently.
- Authentik availability is required for new logins. Already-issued short-lived
  tokens remain usable until expiry unless introspection is configured.
- Environment allowlist changes require an application restart. Agent group
  changes take effect with a fresh access token; admin role snapshots expire no
  later than the bounded local session TTL.
- A compromised agent access token has a bounded lifetime but remains a bearer
  credential during that lifetime.

## Implementation Gate

The repository implementation gate covers config parsing, OIDC adapters,
principal persistence, OpenAPI/discovery contracts, UI login flow, deterministic
Device/JWKS tests, authorization, migration handling, and production security
validation. These runtime requirements are implemented under
[EPIC-011](../roadmap/EPIC-011-authentik-oidc-and-delegated-agent-authentication.md).

Production activation is a separate environment gate. `.env.example.authentik`
remains marked for staging until live Authentik Device Authorization, browser
callback, two-human ownership, key rotation/outage, and rollback evidence pass
through `scripts/checks/check-authentik-staging.ts`.
