# Production Readiness Handoff

## Purpose

This document hands the production-readiness verification to another agent. It
focuses on authentication, Authentik activation, judgement behavior, publishing
gates, runtime safety, and evidence collection. Update the linked acceptance
checklists in place; do not create a parallel source of truth.

## Safety Rules

- Read `AGENTS.md` and the required architecture/setup documents before changes.
- Do not print, copy, commit, or inspect secret values from `.env.secrets`.
- It is acceptable to inspect non-secret selectors in `.env`, `.env.example*`,
  runtime logs, and sanitized command output.
- Never replace or delete `data/` during testing.
- Do not reset or discard the current dirty worktree. It contains intentional,
  uncommitted authentication, judgement, polling, and lifecycle changes.
- Use disposable skills and proposals for destructive or negative scenarios.
- Record timestamps, scenario IDs, proposal IDs, skill/version IDs, HTTP status
  codes, and sanitized log evidence. Never record bearer tokens, cookies,
  authorization codes, subjects, email addresses, or provider response bodies.

## Current State At Handoff

- `./scripts/check.sh` passes with 85 co-located specs.
- The targeted `ProposalReadUseCase` suite passes with 12 tests.
- API typecheck and OpenAPI production generation pass.
- The dependency audit previously reported zero known vulnerabilities.
- Runtime modes observed in sanitized logs:
  - admin authentication: `simple`
  - discovery authentication: `none`
  - published-read authentication: `bearer`
  - proposal authentication: `none`
  - judgement provider: `custom`
- A private custom judger successfully produced persisted proposal, skill
  version, and file judgements.
- Proposal `prop-1784027524931-vrxjd2qfe` was converted to
  `sample-custom-judger-skill@1.0.0`, reviewed, approved, and published.
- Proposal re-judgement completed successfully without reopening its converted
  lifecycle state.
- Reference-version re-judgement completed successfully for the published
  `sample-custom-judger-skill@1.0.0`; proposal, version, and file execution events
  reported `outcome=success` with provider `custom`.
- The public proposal status guidance was corrected so terminal proposals no
  longer advertise stale convert/reject actions. Automated coverage exists for
  all six proposal statuses. Runtime verification of this response remains to
  be performed after a clean restart.
- Real Authentik staging acceptance has not been completed.

## Known Operational Caveat

An attempted `bash scripts/restart-all.sh restart` from a restricted agent
sandbox could not access the local Docker socket while checking the configured
MySQL instance. The script therefore exited before recreating its PID file. At
the time of handoff, listeners were still observed on ports `3040` and `3041`,
but the next operator must perform a clean restart from the normal host shell:

```bash
bash scripts/restart-all.sh restart
bash scripts/restart-all.sh status
tail -n 120 .tmp/restart-all.log
```

Confirm both ports are healthy before any manual acceptance scenario. Treat
startup warnings, repeated restarts, provider failures, and unexpected `401`,
`403`, or `5xx` responses as findings.

## Canonical Evidence Files

- Authentication checklist:
  `docs/setup/AUTHENTICATION_ACCEPTANCE_CHECKLIST.md`
- Authentication profile matrix:
  `docs/setup/AGENT_API_AUTH_TEST_MATRIX.md`
- Authentik setup and activation:
  `docs/setup/AUTHENTIK.md`
- Judgement checklist:
  `docs/setup/JUDGEMENT_ACCEPTANCE_CHECKLIST.md`
- Judger configuration:
  `docs/setup/JUDGER_ADAPTERS.md`
- Environment contract:
  `docs/setup/ENVIRONMENT.md`
- Current state and decisions:
  `docs/progress/CURRENT_STATUS.md` and
  `docs/progress/CHANGELOG_INTERNAL.md`

## Verification Order

### 1. Automated Baseline

Run before changing profiles:

```bash
./scripts/check.sh
npm run build:prod
npm audit --audit-level=moderate
RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh
git diff --check
```

Record command, timestamp, commit hash, result, test counts, proof artifacts,
and warnings. The existing Vite chunk-size warning is known and non-blocking;
new build warnings are not automatically accepted.

### 2. Current Mixed Profile

After a clean restart, verify the currently configured profile:

- Anonymous discovery succeeds.
- Anonymous published reads fail with `401`.
- The configured read bearer token succeeds for skill detail and package reads.
- A valid admin browser session with `reader` or `admin` can read the protected
  published catalog without storing an agent bearer token in the browser.
- Reviewer-only sessions cannot use the published-read session fallback.
- Anonymous proposal create/upload/finalize/status succeeds because proposal
  auth is currently `none`; record that this mode has no verified ownership
  isolation.
- Navigation notice, proposal list, proposal detail, and public proposal status
  poll in the background. Active tabs should issue non-overlapping refreshes at
  approximately 10-second intervals without clearing rendered data or moving
  scroll/selection state. Browsers may throttle background tabs.
- `GET /proposals/prop-1784027524931-vrxjd2qfe/status` returns `converted`, the
  expected `convertedSkillId`, and `adminOnlyNextSteps: []`.

### 3. Judger And Publication Gates

Continue the scenarios in `JUDGEMENT_ACCEPTANCE_CHECKLIST.md`.

- Confirm successful custom-provider proposal and per-file judgements persist
  across restart.
- Re-run proposal judgement and verify status remains `converted`.
- Re-run one stored proposal-file judgement and verify status remains
  `converted`; this branch still needs explicit acceptance evidence.
- Re-run a published reference version and verify its lifecycle remains
  `published`, while a new version judgement and file judgement are appended.
- Force a controlled provider-unavailable case and verify UI/API state is
  `unavailable`, never “completed successfully”.
- Force a controlled provider-failure case and verify UI/API state is `failed`,
  raw provider errors are not exposed, and structured logs contain only a safe
  category.
- Verify `PUBLISH_JUDGEMENT_POLICY=disabled`, `warn`, and `required` separately.
- In `required`, verify missing/failed judgement blocks publish.
- Verify an administrator can override `required` only with a non-empty reason
  and that the override is audited.
- Verify reviewer, publisher, and admin role boundaries independently.
- Confirm `JUDGER_CUSTOM_ADAPTER_PATH` is used only with
  `JUDGER_PROVIDER=custom`; invalid provider/path combinations must fail startup
  in production.

For every run, correlate the UI result with API response, persisted state, and
sanitized `judgement_execution` log events. A successful HTTP response alone is
not sufficient evidence.

### 4. Auth Profile Matrix

Test `none`, `bearer`, and `oidc` independently for each area:

- `DISCOVERY_AUTH_MODE`
- `PUBLIC_READ_AUTH_MODE`
- `PROPOSAL_AUTH_MODE`

At minimum, execute all single-mode profiles plus the production candidate.
For each protected area, prove missing token, malformed token, wrong token,
wrong audience, wrong scope, expired token, and valid token behavior. Verify
that credentials for one area do not authorize another area unless explicitly
configured to do so.

Static bearer production checks must reject short, default, and example secret
values. Bearer/`none` proposal modes do not provide per-human ownership and must
not be described as equivalent to OIDC identity.

### 5. Real Authentik Activation

Use a staging Authentik application/provider and the canonical setup guide.
Do not infer acceptance from deterministic local tokens.

- Verify discovery metadata, issuer, endpoints, JWKS origin, client ID, audience,
  redirect URI, logout behavior, and required scopes against the real tenant.
- Run `scripts/check-authentik-staging.ts` with a genuine access/ID-token pair
  from one authorization. The ID token must be independently valid, match the
  access-token subject and authorization, and still be rejected by the API
  access-token verifier.
- Test the configured access-token validation mode:
  - strict JWT profile requires RFC 9068 `typ=at+jwt`;
  - Authentik `typ=JWT` requires authenticated active-token introspection and
    matching client/subject data.
- Verify signing-key rotation, unknown key reload, provider timeout/outage,
  maximum response size, clock tolerance, and session expiry fail closed.
- Verify Authorization Code with PKCE, state, nonce, one-time login state,
  secure cookie attributes, session revocation, and logout.
- Verify the agent link-out/device flow: an agent obtains a human-login URL,
  the human authenticates in Authentik, and subsequent agent requests identify
  the correct stable principal/uploader without exposing provider tokens in chat.
- Verify all existing eligible Authentik users can propose when configured to do
  so, while admin/reviewer/publisher rights remain explicit role mappings rather
  than blanket tenant membership.
- Run concurrent first-login/linking tests across admin and agent issuers and
  prove one deterministic principal mapping per human.

Do not mark Authentik accepted until browser flow, agent flow, API claims,
persistence, logout/revocation, and failure behavior all agree.

### 6. Runtime And Security Readiness

- Run repeated restart and persistence checks with the production-candidate
  storage providers.
- Verify graceful behavior during MySQL and judger outages and recovery.
- Confirm bounded request/provider bodies, timeouts, concurrency limits, rate
  limits, and no unbounded retry loops.
- Inspect logs for tokens, cookies, authorization codes, email addresses,
  subjects, secrets, stack traces, and uploaded content. Any occurrence is a
  release blocker.
- Verify CORS, Origin/Referer mutation checks, secure cookies, CSP, `nosniff`,
  attachment delivery, path containment, and archive/restore validation.
- Verify only published versions are available through public read endpoints.
- Verify backup/restore using the selected metadata and content-storage
  providers without deleting the source data.
- Confirm OpenAPI runtime-auth extensions match effective behavior for every
  selected profile.

## Evidence Format

Add one row or subsection per scenario to the canonical checklist:

```text
Scenario ID:
Timestamp / timezone:
Commit:
Profile selectors (no secrets):
Actor / expected role:
Proposal or skill/version ID:
Steps:
Expected result:
Observed HTTP/UI result:
Persisted-state evidence:
Sanitized log evidence:
Result: PASS | FAIL | BLOCKED
Finding / follow-up:
```

## Release Decision

Production readiness requires all of the following:

- automated baseline and production build pass;
- dependency audit has no accepted-unreviewed findings;
- selected database/content provider matrix and backup/restore pass;
- selected auth profile passes positive, negative, cross-area, browser, and
  restart tests;
- real Authentik staging gate passes when OIDC is selected for production;
- custom judger success, unavailable, failure, retry, persistence, and role
  boundary scenarios pass;
- selected publication policy and audited override behavior pass;
- no secret/PII leakage or unresolved security finding remains;
- every PASS has reproducible evidence in the canonical checklist.

If any condition is missing, report the system as not yet production-ready and
name the exact blocking scenario IDs.
