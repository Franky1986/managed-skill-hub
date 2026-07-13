# EPIC-011: Authentik OIDC And Delegated Agent Authentication

## Status

Planned. ADR-015, environment target profiles, and operator/agent playbooks are
accepted. Runtime implementation has not started.

## Objective

Implement Authentik-backed OIDC authentication without removing the existing
open and static-bearer deployment modes.

The completed system must support:

- server-side Authentik login for the admin UI;
- OAuth 2.0 Device Authorization for agents acting on behalf of humans;
- stable, verified proposal uploader identity and ownership;
- just-in-time use of the existing Authentik user population;
- independently configurable discovery, published-read, proposal, and admin
  authentication;
- explicit reviewer, publisher, and administrator authorization;
- safe migration from technical actor strings without rewriting historical
  audit truth.

## Governing Decisions

This epic implements
[ADR-015](../decisions/ADR-015-authentik-oidc-and-delegated-agent-identity.md).
It must stay aligned with:

- [Authentik setup playbook](../setup/AUTHENTIK.md)
- [Agent Device Flow guide](../product/AGENT_OIDC_DEVICE_FLOW.md)
- [EPIC-007 static bearer baseline](./EPIC-007-configurable-agent-api-auth.md)
- [ADR-003 current simple admin auth](../decisions/ADR-003-simple-admin-auth.md)

ADR-003 remains the current runtime behavior until the OIDC implementation gate
and rollout proof in this epic are complete.

## User Outcomes

### Existing Authentik users

- No user import is required.
- An active interactive human who can authenticate to the configured Authentik
  application can authorize an agent immediately.
- With `OIDC_PROPOSAL_ACCESS=all_authenticated_users`, no ManagedSkillHub group
  assignment is required for proposal submission.
- The first valid access creates or refreshes a lightweight local principal
  projection; no password is stored.

### Agent submitter

- The agent receives a Device Authorization link from Authentik and shows it in
  the conversation.
- The human authenticates directly at the trusted Authentik origin.
- The agent continues automatically after authorization without asking the
  human to paste credentials or tokens.
- The proposal is attributed to the stable human principal and the public agent
  client where available.

### Proposal status reader

- Any principal accepted by the proposal OIDC policy may read status by known
  proposal UUID.
- There is no non-admin proposal list or enumeration API.
- Only the owning human principal may modify, validate, finalize, or delete an
  open proposal.

### Administrator

- The password form is replaced by `Sign in with Authentik` when
  `ADMIN_AUTH_MODE=oidc`.
- Initial admins may be bootstrapped by stable Authentik user UUID.
- Ongoing reviewer, publisher, and admin access may be managed through
  `managedskillhub-*` groups.
- No Authentik access token is exposed to the browser application.

## Non-Goals

- Do not remove `none`, static `bearer`, or local `simple` modes.
- Do not implement ManagedSkillHub password or user lifecycle management.
- Do not support arbitrary untrusted OIDC issuers or runtime issuer selection
  from token claims.
- Do not add multi-tenancy.
- Do not use an Authentik reverse-proxy provider as the application identity
  boundary; the API validates OIDC credentials itself.
- Do not use the OAuth Implicit, Password, or Resource Owner Password grants.
- Do not request `offline_access` for agent Device Flow in the first release.
- Do not make ID tokens valid API bearer credentials.
- Do not silently run simple and OIDC admin login in parallel.
- Do not rewrite historical audit actor strings as verified identities.

## Authentication Mode Contract

Target selectors:

```env
ADMIN_AUTH_MODE=simple|oidc
DISCOVERY_AUTH_MODE=none|bearer|oidc
PUBLIC_READ_AUTH_MODE=none|bearer|oidc
PROPOSAL_AUTH_MODE=none|bearer|oidc
```

Recommended initial Authentik deployment:

```env
ADMIN_AUTH_MODE=oidc
DISCOVERY_AUTH_MODE=none
PUBLIC_READ_AUTH_MODE=none
PROPOSAL_AUTH_MODE=oidc
OIDC_PROPOSAL_ACCESS=all_authenticated_users
```

Mode behavior must remain area-specific:

| Mode | Authentication result | Identity strength |
|---|---|---|
| `none` | anonymous request context | no verified identity |
| `bearer` | configured static actor | shared technical identity |
| `oidc` | validated Authentik access token | verified human principal and client |

`oidc` discovery mode is supported only for clients that already received
issuer/client configuration out of band. `DISCOVERY_AUTH_MODE=none` remains the
normal Device Flow bootstrap configuration.

## Target Environment Contract

Implement and validate the variables documented in `.env.example.authentik`:

```env
OIDC_AGENT_ISSUER=
OIDC_AGENT_CLIENT_ID=
OIDC_AGENT_BASE_SCOPES=openid,profile,email
OIDC_DISCOVERY_SCOPE=managedskillhub:discovery
OIDC_PUBLIC_READ_SCOPE=managedskillhub:skills:read
OIDC_PROPOSAL_SCOPE=managedskillhub:proposals

OIDC_ADMIN_ISSUER=
OIDC_ADMIN_CLIENT_ID=
OIDC_ADMIN_CLIENT_SECRET=
OIDC_ADMIN_REDIRECT_URI=
OIDC_ADMIN_SCOPES=openid,profile,email

OIDC_PROPOSAL_ACCESS=all_authenticated_users|required_groups
OIDC_PROPOSAL_GROUPS=managedskillhub-submitters
OIDC_PUBLIC_READ_ACCESS=all_authenticated_users|required_groups
OIDC_PUBLIC_READ_GROUPS=managedskillhub-readers

OIDC_ADMIN_SUBJECTS=
OIDC_ADMIN_GROUPS=managedskillhub-admins
OIDC_REVIEWER_GROUPS=managedskillhub-reviewers
OIDC_PUBLISHER_GROUPS=managedskillhub-publishers
```

Configuration validation must fail at startup when:

- an OIDC area lacks issuer, client ID, or required scopes;
- admin OIDC lacks client secret or exact callback URI;
- an issuer or callback URI is not HTTPS outside explicit localhost
  development;
- both simple and OIDC credentials would create an implicit admin fallback;
- an access policy value is unknown;
- `required_groups` has no configured groups;
- admin OIDC has neither bootstrap subjects nor an admin group;
- issuer URLs contain credentials, fragments, or unexpected query strings;
- production secrets retain example/default values.

Secret values must be redacted from config diagnostics and observability.

## Identity Model

Introduce an application-level authenticated principal model. HTTP adapters
construct it; use cases consume stable identity and authorization information
without depending on JWT or Authentik claim shapes.

Suggested contract:

```ts
interface AuthenticatedPrincipal {
  principalId: string;
  kind: 'human' | 'service' | 'technical' | 'anonymous';
  externalSubject: string | null;
  issuer: string | null;
  clientId: string | null;
  displayName: string | null;
  email: string | null;
  groups: string[];
  roles: Array<'submitter' | 'reader' | 'reviewer' | 'publisher' | 'admin'>;
  scheme: 'none' | 'bearer' | 'oidc' | 'session';
}
```

Guardrails:

- `principalId` is the only ownership key.
- Email, username, and display name are never ownership or privileged-role keys.
- Authentik providers use `sub_mode=user_uuid`.
- Correlation across the configured agent and admin issuers is allowed only
  when both issuers belong to the explicitly configured Authentik tenant and
  both use `user_uuid`.
- Service identities are rejected for human-delegated proposal access.
- Controllers do not interpret groups or scopes directly.

## Ports And Architecture

Keep the OIDC integration behind explicit boundaries:

- `IdentityProviderPort`: resolves provider metadata and performs admin code
  exchange through a standards-compliant library.
- `AccessTokenVerifierPort`: validates agent access tokens and returns a
  provider-neutral authenticated principal.
- `PrincipalRepositoryPort`: stores and refreshes just-in-time principal
  projections and external subject mappings.
- `AdminSessionPort`: creates, resolves, expires, and revokes opaque admin
  sessions.
- `OidcLoginTransactionPort`: stores short-lived state, nonce, PKCE verifier,
  return path, expiry, and consumed state.
- `AuthorizationPolicy`: maps provider-neutral principals to ManagedSkillHub
  roles and area permissions.

Adapters may be Authentik-specific, but Domain and use cases must not import
OIDC, JWT, JWKS, OAuth, or Authentik types.

Use a maintained OIDC/JWT standards library. Do not hand-roll JWT parsing,
signature verification, PKCE, JWK handling, or OAuth response validation.

## Persistence Model

Identity/session data follows the configured relational catalog provider so it
works in SQLite and MySQL deployments.

Initial tables or equivalent provider-neutral records:

### `identity_principals`

- internal principal ID
- kind
- current display name and email
- first seen and last seen timestamps
- disabled/local status if later needed

### `identity_external_subjects`

- principal ID
- exact issuer
- external subject
- provider/client identifier
- unique `(issuer, external_subject)` constraint

### `admin_sessions`

- hash of random session ID
- principal ID
- role snapshot
- created, last seen, and absolute expiry timestamps
- revoked timestamp and reason

### `oidc_login_transactions`

- hash of state value
- nonce and PKCE verifier
- exact callback and relative return path
- created and expiry timestamps
- consumed timestamp

Session and transaction cleanup must be bounded and deterministic. Raw session
IDs and OAuth authorization codes must not be persisted.

## Proposal And Audit Migration

Current proposal ownership is a string in `submittedBy`, and audit actors are
technical strings. Migrate additively:

1. Add stable principal ownership fields without destroying existing actor
   labels.
2. New OIDC proposals persist `submittedByPrincipalId` and optional
   `submittedViaClientId`.
3. Existing bearer/open proposals retain their legacy actor semantics.
4. Existing audit records remain unchanged and are marked/displayed as legacy
   technical attribution when no principal mapping exists.
5. New audit records store the stable principal ID plus a display snapshot and
   client ID where applicable.
6. Projection rebuild and filesystem/database content modes preserve the new
   identity fields identically.

The migration must be idempotent for SQLite and MySQL and must not infer a human
identity from a legacy username, email, `X-Actor`, or bearer label.

## Proposal Authorization Rules

| Action | `none` | static `bearer` | OIDC |
|---|---|---|---|
| Create proposal | existing open behavior | configured actor | allowed principal policy |
| Read status by UUID | existing open behavior | valid shared token | any allowed proposal principal |
| List proposals | admin only | admin only | admin/reviewer only |
| Change open proposal | existing legacy ownership | matching bearer actor | owning principal only |
| Validate/finalize/delete | existing legacy ownership | matching bearer actor | owning principal only |
| Review/reject | admin session | admin session | reviewer/admin role |
| Convert/publish | admin session | admin session | publisher/admin role |

Knowing a proposal UUID is never sufficient when the configured area requires
authentication.

Before exposing OIDC identity, change non-admin proposal status so it does not
return:

- email address;
- internal principal ID;
- raw Authentik subject;
- audit entries;
- `duplicateOfProposalId` or other linked private proposal UUIDs.

Published duplicate skill IDs may remain visible because the target skill is
already public.

## Admin Authorization Code Flow

Add these routes or equivalent OpenAPI paths:

- `GET /admin/auth/methods`: non-secret active login mode and login start URL.
- `GET /admin/auth/oidc/start`: create state, nonce, and PKCE transaction and
  redirect to Authentik.
- `GET /admin/auth/oidc/callback`: validate and consume transaction, exchange
  code, resolve principal/roles, create local session, and redirect to an
  allowlisted relative admin route.
- `GET /admin/session`: return local session identity and roles only.
- `POST /admin/logout`: revoke local session, clear cookie, and optionally use
  the provider end-session endpoint.

Security requirements:

- cryptographically random state, nonce, PKCE verifier, and session IDs;
- PKCE S256 only;
- one-time transaction consumption and short transaction TTL;
- exact redirect URI and relative return-path allowlist;
- no open redirect;
- no tokens in query strings after callback completion;
- `HttpOnly`, `Secure`, path-scoped cookie;
- temporary callback state compatible with cross-site top-level navigation;
- established admin session uses the strictest compatible SameSite policy;
- session fixation protection by rotating/clearing existing session cookies;
- absolute session expiry and explicit revocation;
- simple password endpoint disabled in OIDC mode.

The first release does not retain an agent refresh token. Admin application
sessions may outlive the OIDC token used for login, but role snapshots must have
a documented maximum staleness and high-risk operations must not use an
unbounded session.

## Agent Device Authorization Flow

ManagedSkillHub does not proxy the Authentik device transaction. Discovery
provides the public metadata; the agent talks directly to Authentik:

1. Read `/discover` and `/howToPropose`.
2. Complete local package preflight before authentication where possible.
3. POST explicit client ID and scopes to the trusted Device Authorization
   endpoint.
4. Show `verification_uri_complete`; keep `device_code` secret.
5. Poll according to `interval`, `authorization_pending`, `slow_down`, and
   expiry semantics.
6. Use the returned access token only for the advertised API areas.
7. Start a new linkout after token expiry.

The agent client is public and has no client secret. The API accepts access
tokens only when issuer, audience/client, scopes, signature, and human policy
match the configured area.

## Access Token Validation

Validation must include:

- exact configured issuer, never issuer selected from an untrusted token;
- exact expected audience and authorized party/client where applicable;
- asymmetric algorithm allowlist;
- signature against cached provider JWKS;
- expiry and not-before with a small configured clock tolerance;
- required scope for the requested area;
- stable non-empty subject;
- expected human account policy for proposal operations;
- maximum token size and bounded claim/group cardinality.

JWKS behavior:

- cache successful keys with bounded TTL;
- refresh once on an unknown key ID;
- support planned signing-key rotation;
- use strict outbound timeout and response-size limits;
- fail closed on provider, TLS, parse, or validation failure;
- never fetch a JWKS URL supplied by the token itself.

Local JWT payload decoding is not authentication. Introspection may be added as
a configured alternative for opaque tokens, but it must not weaken local JWT
validation or create an unlimited provider dependency per request.

## Role Mapping

Initial group-to-role mapping:

| Authentik configuration | ManagedSkillHub permission |
|---|---|
| `all_authenticated_users` proposal policy | submitter and proposal status reader |
| `managedskillhub-readers` | published skill reader when group policy is active |
| `managedskillhub-submitters` | submitter when group policy is active |
| `managedskillhub-reviewers` | proposal review and rejection |
| `managedskillhub-publishers` | conversion, approval, and publication |
| `managedskillhub-admins` | all admin operations |
| `OIDC_ADMIN_SUBJECTS` | admin bootstrap grant |

Role resolution is server-side. The frontend may hide unavailable actions, but
every route and use case must enforce authorization independently.

## Discovery And OpenAPI Contract

Extend `/discover` auth metadata with an OIDC device scheme containing only
non-secret values:

```json
{
  "id": "proposal-oidc-device",
  "type": "oauth2",
  "flow": "device_code",
  "issuer": "https://auth.example/application/o/managedskillhub-agent-device/",
  "openIdConfigurationUrl": "https://auth.example/application/o/managedskillhub-agent-device/.well-known/openid-configuration",
  "clientId": "managedskillhub-agent-device",
  "scopes": ["openid", "profile", "email", "managedskillhub:proposals"],
  "appliesTo": ["proposal"]
}
```

The runtime may resolve Device Authorization and Token endpoints from provider
metadata. Discovery must expose the resolved HTTPS endpoints agents need.

OpenAPI should use `openIdConnect` where possible and a documented extension
for Device Authorization because standard OpenAPI OAuth flow objects do not
model Device Authorization directly. Security requirements remain explicit per
route.

OIDC authentication failures keep the normalized error envelope and add
machine-readable area, scheme, discovery URL, and reauthentication guidance.
No validation response may reveal why a particular signature/claim failed in a
way that helps token probing; detailed reasons belong in redacted server logs.

## Admin UI Changes

- Fetch active admin authentication methods before rendering login.
- Show username/password inputs only in simple mode.
- Show one `Sign in with Authentik` command in OIDC mode.
- Keep callback processing server-side; the SPA never exchanges an OAuth code.
- Extend session state with display name and roles, not OAuth tokens.
- Route expired/revoked sessions back to login with a clear message.
- Disable or hide actions outside the current role while retaining server-side
  enforcement.
- Logout always clears the local session even if provider logout fails.

## Observability And Audit

Add redacted operational events and metrics for:

- login start, success, denial, callback failure, and replay rejection;
- Device token validation success/failure by reason category, never token;
- principal creation/update;
- session creation, expiry, and revocation;
- authorization denial by route and required role;
- JWKS refresh, rotation, timeout, and stale-cache use;
- proposal owner mismatch;
- configured auth mode per area at startup without secrets.

Do not log raw tokens, authorization codes, state, nonce, PKCE verifier, session
IDs, client secret, cookies, full claims, or email addresses in routine logs.

## Implementation Phases

### Phase 1: Configuration And Provider-Neutral Identity

1. Extend auth mode parsing and production fail-fast validation.
2. Introduce principal, authorization policy, and request-context contracts.
3. Preserve current `none` and static `bearer` behavior through compatibility
   adapters.
4. Add config specs and tests for supported/invalid mixed modes.

### Phase 2: Identity And Session Persistence

1. Add SQLite and MySQL schemas for principals, external subjects, sessions,
   and login transactions.
2. Implement provider-neutral ports and both relational adapters.
3. Add bounded cleanup and transaction/replay tests.
4. Add JIT principal projection without importing Authentik users.

### Phase 3: Admin OIDC

1. Implement provider metadata loading and Authorization Code + PKCE.
2. Add login start, callback, session, and logout routes.
3. Refactor admin guards/controllers to consume one principal context instead
   of repeatedly revalidating `SimpleAdminAuth` and reading `username`.
4. Implement reviewer/publisher/admin route authorization.
5. Update admin UI and session contract.

### Phase 4: Agent OIDC And Discovery

1. Implement strict Authentik access-token verification.
2. Add OIDC mode to discovery, public-read, and proposal guards.
3. Extend `/discover`, `/howToPropose`, normalized errors, and OpenAPI.
4. Update agent contract proof for Device Authorization metadata.
5. Preserve static bearer credential setup for bearer-mode deployments.

### Phase 5: Proposal Principal Ownership And Privacy

1. Add stable principal ownership and agent-client attribution.
2. Migrate persistence, projections, DTOs, and rebuild logic additively.
3. Keep legacy actor attribution intact and visibly unverified.
4. Enforce owner-only mutations under OIDC.
5. Permit status-by-known-UUID for any allowed proposal principal.
6. Remove personal/internal and linked-proposal identifiers from non-admin
   status.

### Phase 6: Proof, Rollout, And Documentation Activation

1. Extend deterministic auth mode tests from the current eight
   `none`/`bearer` combinations to all 27 agent-area combinations.
2. Add both admin modes to config and controller proofs.
3. Add a local deterministic fake OIDC/JWKS provider for normal CI.
4. Add an optional real-Authentik staging/full-check gate.
5. Run the Authentik cutover checklist and key-rotation proof.
6. Remove the target-only warning from `.env.example.authentik` only after all
   acceptance criteria pass.
7. Update ADR-003 status when OIDC becomes the production-ready path.

## Test Matrix

### Protocol and token tests

- valid Authorization Code callback with state, nonce, and PKCE;
- missing, mismatched, expired, replayed, and already-consumed state;
- wrong nonce and invalid PKCE exchange;
- exact callback and blocked open redirect;
- wrong issuer, audience, client, scope, algorithm, signature, key, token type,
  expiry, and not-before;
- missing subject, service account, excessive groups, and oversized token;
- JWKS cache hit, unknown-key refresh, rotation, timeout, malformed response,
  and outage;
- logout success and provider-logout failure with local session cleanup.

### Authorization tests

- every authenticated human can submit under `all_authenticated_users`;
- group membership required under `required_groups`;
- another authenticated human can read status by UUID;
- another human cannot patch, upload, validate, finalize, or delete;
- same human through a new agent session can continue an open proposal;
- reviewer cannot publish unless also publisher/admin;
- publisher cannot perform admin-only operational actions;
- subject UUID and group admin grants are additive;
- username/email changes do not change ownership or privilege;
- removed group access expires within the documented session/token window.

### Compatibility tests

- simple admin login remains unchanged in simple mode;
- password login is unreachable in OIDC mode;
- all existing `none` and static `bearer` route semantics remain intact;
- SQLite/MySQL and filesystem/database-content modes preserve identity fields;
- root and `/api` aliases apply the same auth and rate-limit context;
- proposal rate limiting keys OIDC requests by stable principal/client without
  unbounded cardinality;
- OpenAPI and runtime route/security parity passes.

### Browser tests

- OIDC login start, callback, authenticated navigation, role-specific actions,
  session expiry, and logout;
- no token in URL after callback, localStorage, sessionStorage, console, or
  frontend network response bodies;
- cookie flags and CSRF/origin checks under production topology;
- callback works through the configured reverse proxy and API prefix.

## Files And Boundaries Likely To Change

### Configuration and container

- `apps/api/src/infrastructure/config.ts`
- `apps/api/src/infrastructure/config.test.ts`
- `apps/api/src/infrastructure/container.ts`
- `.env.example`, `.env.example.simple`, `.env.example.authentik`

### HTTP identity adapters

- `apps/api/src/adapters/inbound/http/agent-api-auth.ts`
- `apps/api/src/adapters/inbound/http/simple-admin-auth.ts`
- `apps/api/src/adapters/inbound/http/admin-auth.controller.ts`
- admin/proposal/skill/judgement controllers and their co-located specs
- new OIDC admin, access-token, principal-context, and authorization adapters

### Application ports and identity

- new identity/session/authorization ports and co-located specs
- proposal command/read use cases for principal ownership
- audit DTOs and mapping for principal/client attribution

### Persistence

- SQLite and MySQL schema files
- catalog projections and hydrators
- filesystem and database aggregate persistence
- projection rebuild and migration proof fixtures

### Contracts and UI

- `packages/openapi/skill-registry.openapi.yaml`
- `apps/web/src/store/auth.ts`
- `apps/web/src/api/admin.ts`
- `apps/web/src/pages/admin/AdminLoginPage.tsx`
- admin router/guards and role-dependent commands

### Proof and operations

- `scripts/check-agent-auth-matrix.ts`
- `scripts/check-agent-contract.ts`
- new deterministic OIDC/JWKS proof script or fixture server
- `scripts/full-check.sh`
- setup, deployment, testing, agent, architecture, progress, and ADR docs

## Security Invariants

- Only configured HTTPS issuers are trusted.
- Only access tokens authorize APIs; ID tokens do not.
- The browser never receives Authentik access or refresh tokens.
- Agent chat never contains secrets, credentials, device codes, or tokens.
- Static bearer tokens never grant admin permissions.
- Proposal ownership uses a stable principal ID, never mutable profile data.
- Service accounts cannot satisfy the human-delegated proposal policy.
- Every callback transaction is one-time and replay-resistant.
- Every OIDC-selected production configuration fails closed when provider or
  validation prerequisites are unavailable.
- Non-admin proposal status does not leak personal identity or linked private
  proposal identifiers.
- Existing published-only public read invariants remain unchanged.

## Rollout Plan

1. Ship schemas, ports, config parsing, and dormant OIDC adapters while current
   modes remain active.
2. Enable admin OIDC in staging with subject UUID bootstrap.
3. Prove reviewer, publisher, admin, logout, expiry, and key rotation.
4. Enable proposal OIDC in staging with
   `OIDC_PROPOSAL_ACCESS=all_authenticated_users`.
5. Prove two-human ownership and known-UUID status behavior through real Device
   Authorization.
6. Run the full 27-combination agent auth matrix and both admin modes.
7. Enable production OIDC one area at a time; keep discovery open.
8. Remove obsolete password secrets only after the rollback window.

Rollback restores the last proven simple/bearer profile, invalidates OIDC local
sessions, and records the reason. It must not delete principal or audit data and
must never delete `data/`.

## Acceptance Criteria

- All target auth modes parse, validate, and compose independently.
- Every active interactive Authentik user can authorize an agent and submit a
  proposal under the default policy without pre-provisioning or group
  assignment.
- A second authenticated user can read status by known UUID but cannot mutate
  the proposal.
- The same human can continue an open proposal from another authorized agent
  session.
- Admin web login uses server-side Authorization Code + PKCE and exposes no
  provider token to the SPA.
- Admin subject bootstrap and `managedskillhub-*` group roles work as
  documented.
- Local username/password is not required and its endpoint is disabled in OIDC
  mode; simple mode remains supported.
- Access-token validation passes issuer, audience, client, scope, signature,
  time, human-policy, JWKS-rotation, and outage tests.
- OIDC proposal/audit attribution uses stable principal and client identity;
  legacy actors remain intact and unverified.
- Non-admin status contains no email, internal subject/principal, audit data, or
  linked private proposal UUID.
- OpenAPI, discovery, frontend, agent guidance, environment profiles, and
  runtime behavior agree.
- SQLite/MySQL and filesystem/database-content provider proofs pass.
- `./scripts/check.sh` passes without a live Authentik dependency.
- The optional real-Authentik staging/full-check gate passes before production
  activation.
- `.env.example.authentik` no longer carries a target-only warning only after
  every preceding criterion is met.

## Definition Of Done

- Code, co-located specs, OpenAPI, tests, proof scripts, UI, setup playbooks,
  agent docs, architecture docs, progress docs, and ADR status are consistent.
- No secret or private Authentik deployment value is committed.
- Dependency audit is clean at the repository's configured severity gate.
- Production cutover and rollback are rehearsed and documented with proof
  artifacts.
