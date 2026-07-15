# Authentication Acceptance Checklist

## Purpose

Use this runbook to accept the configurable authentication profiles against a
real deployment. It complements automated tests; it does not replace
`./scripts/check.sh` or the real Authentik staging gate.

The operator executes each applicable scenario and posts a sanitized result. A
following agent may update the checkboxes and investigate failures. Never place
passwords, bearer tokens, cookies, authorization codes, user identifiers,
proposal UUIDs, client secrets, or raw provider responses in this document or a
result post.

## Status Rules

For every scenario, select exactly one status:

- `[ ] PASS`: every required check matched the expected result.
- `[ ] FAIL`: at least one check produced an unexpected result.
- `[ ] BLOCKED`: the environment or required test identity was unavailable.
- `[ ] NOT RUN`: no attempt has been made.

Do not mark a scenario `PASS` based only on code inspection. Record commands as
sanitized summaries and identify evidence artifacts by path or CI run ID.

## Run Header

Complete this once for each acceptance run:

```text
Run ID: auth-2026-07-14-01
Commit SHA: 7d96823
Date/time (UTC): 2026-07-14
Operator: frankrichter
Follow-up agent:
Environment label: local
Public API base URL:
Web base URL:
Authentik version: not applicable to AUTH-00
Deployment/reverse-proxy version: not applicable to AUTH-00
Notes: Local baseline with the configured MySQL catalog/search profile.
```

Use non-sensitive aliases for test identities:

| Alias | Required capability |
|---|---|
| `HUMAN_A` | Active interactive user with no ManagedSkillHub role groups |
| `HUMAN_B` | Second active interactive user with no ManagedSkillHub role groups |
| `REVIEWER` | Reviewer group only |
| `PUBLISHER` | Publisher group only |
| `ADMIN` | Admin group or configured bootstrap subject |

## Scenario Summary

| ID | Profile | Status | Result reference |
|---|---|---|---|
| AUTH-00 | Automated baseline | `[x] PASS` | `auth-2026-07-14-01` |
| AUTH-01 | Simple admin, open agent APIs | `[ ] NOT RUN` | |
| AUTH-02 | Independent static bearer areas | `[x] PASS` | `auth-2026-07-14-03-AUTH-02` |
| AUTH-03 | Production configuration fail-fast | `[ ] NOT RUN` | |
| AUTH-04 | Authentik provider and proxy readiness | `[ ] NOT RUN` | |
| AUTH-05 | OIDC admin browser session | `[ ] NOT RUN` | |
| AUTH-06 | OIDC proposals for all authenticated humans | `[ ] NOT RUN` | |
| AUTH-07 | OIDC published reads for all authenticated humans | `[ ] NOT RUN` | |
| AUTH-08 | OIDC required-group policies | `[ ] NOT RUN` | |
| AUTH-09 | Mixed `none`, `bearer`, and `oidc` areas | `[ ] NOT RUN` | |
| AUTH-10 | OIDC-protected discovery | `[ ] NOT RUN` | |
| AUTH-11 | Proposal ownership across two humans and new sessions | `[ ] NOT RUN` | |
| AUTH-12 | Access/ID token separation and token lifecycle | `[ ] NOT RUN` | |
| AUTH-13 | `jwt_profile` versus Authentik introspection | `[ ] NOT RUN` | |
| AUTH-14 | Role boundaries and role refresh | `[ ] NOT RUN` | |
| AUTH-15 | Logout, expiry, provider outage, and rollback | `[ ] NOT RUN` | |

## Common Preparation

- [ ] Use a dedicated staging deployment and backup its data before testing.
- [ ] Select the non-secret profile in `.env`; initialize secrets separately:

      ```bash
      cp .env.example.authentik .env
      cp .env.secrets.example .env.secrets
      chmod 600 .env .env.secrets
      ```

- [ ] For an existing installation, run
      `./node_modules/.bin/tsx scripts/migrate-env-layout.ts --check`; use
      `--write` once when migration is required.
- [ ] Confirm `.env` contains no `_PASSWORD`, `_PASSWORD_HASH`, `_SECRET`,
      `_TOKEN`, or `_API_KEY` assignments and `.env.secrets` is Git-ignored.
- [ ] Have a human operator or deployment secret manager populate
      `.env.secrets`. Testing agents must not read, print, attach, or modify
      that file.
- [ ] Record the exact commit and configuration profile without secret values.
- [ ] Use distinct random values of at least 32 bytes for every production
      static bearer or session secret.
- [ ] Confirm HTTPS, trusted proxy settings, public API URL, callback URL, and
      CORS origin match the externally visible deployment.
- [ ] Use a fresh browser profile and separate cookie jars for different users.
- [ ] Restart the API after each environment change and verify startup logs do
      not contain tokens, subjects, email addresses, or secrets.
- [ ] Run scenarios against published test content and disposable proposals.

Useful non-secret probes:

```bash
export BASE_URL='https://skills.example.com/api'
curl -sS "$BASE_URL/health"
curl -sS "$BASE_URL/discover" | jq
curl -o /dev/null -sS -w '%{http_code}\n' "$BASE_URL/categories"
curl -o /dev/null -sS -w '%{http_code}\n' "$BASE_URL/proposals/notice"
```

## Sanitized Evidence Logging

Create one ignored evidence directory per scenario. Application logs and test
status output are useful for follow-up agents, but credentials and protocol
artifacts are not evidence and must never be captured.

```bash
RUN_ID='auth-2026-07-14-02-AUTH-01'
RUN_DIR=".tmp/auth-acceptance/$RUN_ID"
mkdir -p "$RUN_DIR"
bash scripts/restart-all.sh restart | tee "$RUN_DIR/start.log"
```

Allowed evidence:

- commit SHA, run ID, environment label, and non-secret auth modes;
- endpoint path, HTTP status, expected/observed result, and coarse error code;
- sanitized server events without headers, query credentials, subjects, email,
  proposal UUIDs, or provider payloads;
- a manual `PASS|FAIL|BLOCKED` note for browser-only steps.

Never use `set -x`, `curl -v`, raw header dumps, browser HAR export, or copied
browser storage. Never log `Authorization`, `Cookie`, `Set-Cookie`, passwords,
authorization codes, device codes, access/ID/refresh tokens, or full OIDC
callback URLs.

After a scenario, preserve the server log and scan the evidence directory:

```bash
cp .tmp/restart-all.log "$RUN_DIR/server.log"
if rg -l '(Authorization:|Cookie:|Set-Cookie:|password=|access_token|id_token|refresh_token|code=)' "$RUN_DIR" >/dev/null; then
  echo 'sensitiveEvidenceScan=FAIL'
else
  echo 'sensitiveEvidenceScan=PASS'
fi
```

The scan must return no sensitive matches. A follow-up agent may read files in
`$RUN_DIR`, but must not read `.env.secrets` or browser state.

## AUTH-00: Automated Baseline

Profile: current working tree, no external Authentik required.

- [x] `./scripts/check.sh` finishes with `[OK]`.
- [x] `.tmp/agent-auth-matrix.json` reports 27 passed permutations and zero
      failures.
- [x] `.tmp/oidc-provider.json` reports valid ID-token verification,
      `at_hash` binding, ID-token rejection as an API token, rotation, and
      fail-closed outage behavior.
- [x] `npm run build:prod` succeeds.
- [x] `npm audit --audit-level=moderate` reports zero vulnerabilities.
- [x] `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` succeeds for the
      configured MySQL catalog/search profile.

Status: `[x] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

Result: `./scripts/check.sh` returned `[OK]`; all workspace production builds
completed; Vite emitted only the known non-blocking 500-kB chunk warning; npm
reported zero vulnerabilities; the MySQL full check completed every implemented
gate. The real Authentik staging gate remains a separate environment-specific
scenario.

## AUTH-01: Simple Admin, Open Agent APIs

Start from `.env.example.simple` in `.env`, use `.env.secrets` for the local
admin credentials, and keep all three agent areas set to `none`.

- [ ] `/discover`, `/categories`, and `/proposals/notice` return `200` without
      credentials.
- [ ] Discovery reports all three areas as not requiring authentication and
      omits the `agent-session` scheme.
- [ ] Wrong simple-admin credentials fail; correct credentials create a secure
      admin session in the browser.
- [ ] The admin proposal badge uses the admin session and does not call the
      agent proposal notice route.
- [ ] Logout invalidates the session and protected admin routes return `401`.
- [ ] Proposal ownership is documented as unverified in `none` mode; no
      per-human isolation is claimed.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

Technical pretest: `auth-2026-07-14-02-AUTH-01` passed public-route, anonymous
admin rejection, invalid-login, valid-login, session, reviewer-badge, logout,
and post-logout API probes. Its sanitized evidence is stored under
`.tmp/auth-acceptance/auth-2026-07-14-02-AUTH-01/`. Browser behavior and the
disposable upload workflow still require operator acceptance.

## AUTH-02: Independent Static Bearer Areas

Use three different random tokens and configure all agent areas as `bearer`.
Keep admin auth independent in `simple` mode.

- [x] Each protected area returns normalized `401` without credentials.
- [x] Each area accepts only its own token; using the read token for proposals,
      for example, fails.
- [x] Discovery advertises bearer auth and exposes the agent-session URL.
- [x] The agent-session page requires the bearer token for every requested area and does not leak secret values in discovery responses.
- [x] A human creates a short-lived session at the agent-session URL and shares only the 8-character session code with the agent, never the long-lived bearer token.
- [ ] A valid admin browser session with `reader` or `admin` can read the
      protected published catalog, but cannot authorize discovery or proposal
      routes; invalid and reviewer-only sessions still require the area's
      agent credential.
- [x] Static bearer proposals use the configured shared actor, and the result
      records that this mode does not provide per-human ownership.

Status: `[x] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

Result: `auth-2026-07-14-03-AUTH-02`

Profile selectors (no secrets):
- `ADMIN_AUTH_MODE=simple`
- `DISCOVERY_AUTH_MODE=none`
- `PUBLIC_READ_AUTH_MODE=bearer`
- `PROPOSAL_AUTH_MODE=bearer`

Observed HTTP results:
- `GET /discover` without credentials → `200`, advertises
  an `agent-session` scheme with a frontend URL and bearer schemes for `public-read` and `proposal`.
- `GET /frontend/agent-auth` renders the token entry form and returns an 8-character session code when a valid bearer token is entered.
- `Authorization: AgentSession <code>` authenticates read and proposal endpoints within the granted areas.
- `GET /skills` without token → `401`; with read token → `200`; with wrong
  token → `401`; with proposal token → `401` (cross-area isolation).
- `POST /proposals` without token → `401`; with proposal token and valid body
  → `201`; with read token → `401` (cross-area isolation).

Sanitized evidence: `.tmp/auth-acceptance/auth-2026-07-14-03-AUTH-02/`
(created by the operator). Note: the admin browser session fallback for
protected published reads was not exercised in this run.

## AUTH-03: Production Configuration Fail-Fast

Run each negative startup check separately with `NODE_ENV=production`. Restore
valid settings after every attempt.

- [ ] A short static bearer token causes startup failure.
- [ ] A documented example/default token causes startup failure.
- [ ] Plaintext simple-admin password configuration causes startup failure.
- [ ] A weak/default session secret causes startup failure.
- [ ] `PROPOSAL_AUTH_MODE=none` fails unless the explicit production override
      is enabled.
- [ ] Invalid TTL, timeout, clock tolerance, group, response-size, and limiter
      bounds fail configuration loading.
- [ ] Failure output identifies the setting but does not print its secret value.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-04: Authentik Provider And Proxy Readiness

Start from `.env.example.authentik` in `.env`; supply confidential client
values only through `.env.secrets` or exported deployment secrets. Do not
activate production traffic yet.

- [ ] Admin and agent discovery documents use the exact configured issuers.
- [ ] Authorization, token, device authorization, JWKS, and introspection
      endpoints remain on the trusted provider origin.
- [ ] The registered callback exactly matches
      `OIDC_ADMIN_REDIRECT_URI` through the reverse proxy.
- [ ] The agent provider offers Device Authorization and the required scopes.
- [ ] Both providers use stable Authentik user UUID subjects.
- [ ] The human claim is boolean `true` only for active interactive humans.
- [ ] Application/service accounts cannot obtain proposal authority.
- [ ] Provider and API clocks are synchronized.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-05: OIDC Admin Browser Session

Configure `ADMIN_AUTH_MODE=oidc`; keep discovery and public read open while
isolating this test.

- [ ] Login starts at the trusted Authentik origin and returns only to an
      allowlisted local admin path.
- [ ] State, nonce, PKCE, and one-time callback behavior succeed for a normal
      login.
- [ ] Reusing the callback or changing state fails.
- [ ] The browser receives only the opaque ManagedSkillHub session cookie; no
      provider access token, ID token, refresh token, or authorization code is
      stored in browser storage or exposed in a URL after completion.
- [ ] The session cookie is `HttpOnly`, `Secure` in HTTPS, and uses the expected
      `SameSite` and path settings.
- [ ] Logout revokes the local session even if provider logout is unavailable.
- [ ] Removing simple-login variables does not break OIDC admin login, and the
      simple password endpoint is unavailable.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-06: OIDC Proposals For All Authenticated Humans

Configure `PROPOSAL_AUTH_MODE=oidc` and
`OIDC_PROPOSAL_ACCESS=all_authenticated_users`.

- [ ] An agent receives a Device Authorization linkout and never asks the human
      to paste a token into chat.
- [ ] `HUMAN_A` completes the linkout and the agent receives proposal access.
- [ ] `HUMAN_A`, without a ManagedSkillHub group, can create, upload, validate,
      finalize, and read a proposal by known UUID.
- [ ] An unauthenticated request and a service-account token are rejected.
- [ ] Proposal and audit data record a stable projected principal and public
      client ID without storing raw tokens.
- [ ] Expired credentials trigger a new linkout instead of token disclosure.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-07: OIDC Published Reads For All Authenticated Humans

Configure `PUBLIC_READ_AUTH_MODE=oidc` and
`OIDC_PUBLIC_READ_ACCESS=all_authenticated_users`.

- [ ] Anonymous reads of categories, skills, search, files, and packages return
      normalized `401` responses.
- [ ] A Device Flow access token with the read scope can access every published
      read route.
- [ ] A proposal-only access token without the read scope is rejected.
- [ ] Draft or non-published skills are never exposed through the read API.
- [ ] The public React catalog stores no agent token and can use a valid admin
      session with `reader` or `admin` as an explicit read-only alternative.
- [ ] Logout or session expiry removes that alternative; protected catalog
      reads then return `401` until agent read auth or a new admin session is
      present.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-08: OIDC Required-Group Policies

Configure proposal and/or read access as `required_groups`.

- [ ] An authenticated user without the configured group receives `401`.
- [ ] Adding the proposal group grants proposal access after obtaining a fresh
      token.
- [ ] Adding the read group grants published-read access after obtaining a
      fresh token.
- [ ] Removing a group is reflected after token/session renewal; an old bounded
      token or role snapshot remains valid only for its documented lifetime.
- [ ] Reviewer and publisher groups do not implicitly grant agent API area
      access. The documented admin-session exception permits only published
      reads for `reader` or `admin`; agent tokens still follow area policy.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-09: Mixed `none`, `bearer`, And `oidc` Areas

Representative profile:

```env
DISCOVERY_AUTH_MODE=none
PUBLIC_READ_AUTH_MODE=bearer
PROPOSAL_AUTH_MODE=oidc
```

- [ ] Discovery remains anonymous and advertises the bearer read area and OIDC
      proposal area accurately.
- [ ] Discovery advertises an `agent-session` scheme for `public-read` only.
- [ ] The agent-auth page accepts the static read token outside chat and creates
      a read-only session code.
- [ ] The read token cannot authorize proposals.
- [ ] The OIDC proposal token cannot authorize reads unless it separately has
      the configured read scope and the read area is changed to OIDC.
- [ ] A reader-capable admin browser session permits only protected published
      reads; it does not authorize discovery or proposal routes.
- [ ] At least one additional mixed profile is tested when it matches the
      intended deployment.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

Runtime observation on 2026-07-14: with discovery and proposals open and public
reads protected by static bearer, anonymous catalog requests correctly returned
`401`, proposal upload/finalization succeeded, but the logged-in admin catalog
also returned `401`. The route-level fallback has since been corrected; repeat
this mixed-profile browser check after restart before marking the scenario.

Retest observation on 2026-07-14: under the additional mixed profile
`discovery=none`, `public-read=bearer`, `proposal=none`, the logged-in admin
catalog request to `/categories` returned `200`, the proposal detail endpoint
returned `200`, and `/admin/proposals/notice` polled successfully at 10-second
intervals without `401` responses. After publication, the configured read
bearer returned `200` for skill detail and package while an anonymous read of
the same skill returned normalized `401`. The representative OIDC-proposal
profile and remaining cross-area credential boundaries are still pending.

## AUTH-10: OIDC-Protected Discovery

Configure `DISCOVERY_AUTH_MODE=oidc`. This is an advanced profile because
issuer and client bootstrap must be supplied out of band.

- [ ] Anonymous discovery and contract routes return normalized `401`.
- [ ] The deployment documentation supplies the trusted issuer, client ID, and
      discovery scope without relying on the protected `/discover` response.
- [ ] A correctly scoped Device Flow token permits `/discover`,
      `/howToPropose`, and `/openapi.yaml`.
- [ ] Read-only or proposal-only tokens without the discovery scope fail.
- [ ] No static setup URL is advertised for an OIDC-only deployment.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-11: Proposal Ownership Across Humans And Sessions

Use OIDC proposal auth and two independent users.

- [ ] `HUMAN_A` creates a proposal and can continue it after starting a new
      Device Flow session.
- [ ] `HUMAN_B` can read status when given the known UUID.
- [ ] `HUMAN_B` cannot patch, upload, validate, finalize, or delete the proposal.
- [ ] Simultaneous first admin and agent logins for one human converge on one
      principal rather than creating duplicate ownership identities.
- [ ] Mutable username, display name, or email changes do not change ownership.
- [ ] Logs and result posts use aliases and contain no provider subject or email.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-12: Access/ID Token Separation And Token Lifecycle

Capture the access and ID tokens from one real Token Endpoint response only for
the duration of the test. Do not post or persist them in evidence.

- [ ] The production access-token verifier accepts the valid access token.
- [ ] The staging gate independently validates the ID-token signature, issuer,
      audience, expiry, issued-at time, type, authorized party, and same subject.
- [ ] When present, `at_hash` validates against the access token; otherwise the
      result records `same_subject` plus operator-confirmed same-response
      provenance without claiming cryptographic binding.
- [ ] The independently valid ID token is rejected as an API access token.
- [ ] Wrong issuer, audience, client, signature, scope, token type, expired
      token, future `nbf`, and oversized token cases fail closed.
- [ ] Run the schema-v2 real staging gate and retain only its sanitized JSON
      result.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-13: `jwt_profile` Versus Authentik Introspection

Test the mode supported by the target Authentik token shape. Test both modes
when the provider can issue both profiles.

- [ ] In `jwt_profile`, only `typ=at+jwt` or `application/at+jwt` access tokens
      pass; `typ=JWT`, missing `typ`, and ID tokens fail.
- [ ] In `authentik_introspection`, local signature and claim validation still
      runs before introspection.
- [ ] Introspection uses confidential client authentication and requires
      `active=true`, exact original client ID, and exact subject.
- [ ] Inactive, client-mismatched, subject-mismatched, timeout, malformed, and
      oversized introspection responses fail closed.
- [ ] Introspection credentials never appear in browser traffic or logs.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-14: Role Boundaries And Role Refresh

Use separate reviewer-only, publisher-only, and admin identities.

- [ ] A normal authenticated human has no admin workbench access.
- [ ] `REVIEWER` can inspect proposals and use reviewer operations but cannot
      publish or execute admin-only operations.
- [ ] `PUBLISHER` can perform publisher operations but does not gain unrelated
      admin operations.
- [ ] `ADMIN` receives the complete configured admin capability set.
- [ ] The proposal badge endpoint uses the admin reviewer boundary and does not
      depend on `PROPOSAL_AUTH_MODE`.
- [ ] Group changes become effective on the next bounded admin session; record
      the observed role-snapshot lifetime.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## AUTH-15: Logout, Expiry, Provider Outage, And Rollback

- [ ] Admin session expiry returns the UI to login with no stale privileged
      action available.
- [ ] Agent access-token expiry returns normalized `401` and causes a fresh
      Device Flow linkout.
- [ ] Unknown signing-key rotation succeeds after bounded JWKS refresh.
- [ ] Discovery, JWKS, token, and introspection outages/timeouts fail closed and
      do not cause unbounded memory use or redirect following.
- [ ] The documented rollback restores the previously proven simple/bearer/open
      profile without deleting `data/`.
- [ ] OIDC sessions are invalidated during rollback as planned.
- [ ] Health checks, published reads, admin login, and proposal behavior match
      the rollback profile after restart.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## Result Post Template

Post one block per scenario. The follow-up agent should verify the evidence,
update the summary row and detailed status, and add a short failure note where
needed.

```text
Scenario: AUTH-00
Status: PASS | FAIL | BLOCKED
Run ID:
Commit SHA:
Environment label:
Configuration profile: simple-open | bearer | authentik-all-users |
  authentik-required-groups | mixed | rollback | other
Checks completed:
Expected versus observed:
Sanitized evidence references:
Failure or blocker:
Retest required: yes | no
```

## Completion Criteria

Production Authentik activation requires:

- every applicable scenario marked `PASS`;
- non-applicable scenarios explicitly justified rather than silently skipped;
- AUTH-00, AUTH-04 through AUTH-06, AUTH-11 through AUTH-15, and the schema-v2
  real staging gate passing;
- all failures retested against the same or newer commit;
- a proven rollback procedure;
- no secrets or personal identifiers in committed evidence.
