## 2026-07-15: Public Release Review Remediation

- Split duplicate detection into a public metadata/fingerprint-only preflight
  and an internal finalized-proposal assessment. The public route rejects unknown
  fields such as `proposalId`, reads no stored files, and never invokes an LLM.
- Internal semantic enrichment excludes the current proposal, compares only with
  published skills, is bounded to three strong candidates, uses hardened
  untrusted-content delimiters, and fails closed to manual review.
- Auto-publish now performs one duplicate assessment after green judgement gates;
  exact duplicates, skill-ID collisions, threshold matches, and unavailable
  semantic enrichment all prevent automatic publication.
- Hardened filesystem identifier segments against traversal and limited exact
  proposal digest matching to finalized review states.
- Updated Proposal/OpenAPI contracts, Agent Session proofs, admin count polling,
  release hygiene, CI branch coverage, deployment packaging, and security-reporting
  guidance. Removed the stray untracked `EOF` artifact.
- Verification: 94 co-located specs, 441 API tests, 36 web tests, all deterministic
  proof scripts, production builds, 25 public-release hygiene checks, and the
  moderate lockfile audit pass; the audit reports zero vulnerabilities.

## 2026-07-15: Agent And Admin Duplicate UX Hardening

- `/api/howToPropose` step 9 and `duplicateConfirmationRule` now instruct agents
  to prefer the `create_new_version` resolution when `skillIdCollision.exists`
  is true, and to explain explicitly that auto-publish is not possible and an
  admin must convert the proposal into a new draft version.
- `duplicate-check.usecase.ts` `create_new_version` resolution option now states
  that the option is recommended for revisions and requires admin conversion
  and publication; it cannot auto-publish.
- Admin proposal filter buttons now show a submitted/judged breakdown for the
  "open" filter (e.g. `Open (4/12)`) while keeping in_upload and converted
  counts separate. The top navigation already shows the combined
  `Proposals (open/in_upload/converted)` badge.

## 2026-07-15: Semantic Duplicate Gate Runtime Fix

- `duplicate-check.usecase.ts` now excludes the current proposal id from
  `findProposalByContentDigest`, preventing a proposal's own content digest
  from short-circuiting similar-match detection.
- `proposal.controller.ts` now forwards `proposalId` from the
  `POST /proposals/check-duplicate` body so the exclusion works for agents
  re-checking after attaching files.
- Added unit test verifying that a proposal matching its own content digest
  still receives scored similar matches when `proposalId` is supplied.
- Runtime verification:
  - Near-duplicate of an existing published skill is blocked by auto-publish
    with `manual_review_required` and a semantic-similarity reason.
  - Genuinely new skill passes duplicate precheck with no similar matches.
  - Existing unit tests for duplicate-check, auto-publish, and proposal
    controller remain green.

## 2026-07-14: Runtime acceptance test of auto-publish gates

Ran a single-shell acceptance test against the running API with
`AUTO_APPROVE_WITHOUT_JUDGER=true` to isolate the auto-publish gate behavior:

- **SkillId collision gate**: A proposal with `skillId: sample-integration`
  finalized into `judged` and was blocked with
  `autoPublishBlockedReason: manual_review_required`. The gate works as intended.
- **Exact content duplicate gate**: A second upload of the same "Video Trimmer"
  content was blocked with `autoPublishBlockedReason: duplicate_or_collision`,
  proving the content-digest duplicate blocker works.
- **Semantic duplicate gate**: Could not be reached in this run because the
  Vercel AI SDK judger returned a real judgement that was not fully green for
  the near-duplicate `Sample Integration Revised` content. The unit tests
  confirm the gate logic; reaching it at runtime requires content that passes
  all judgement dimensions as low.
- **Admin notice counts**: The public `/admin/proposals/notice` endpoint requires
  an admin session; basic auth is not supported.

The test was run with the API server started and stopped inside one command to
avoid sandbox background-process termination.

## 2026-07-14: Show proposal counts on admin proposal filter buttons

- `AdminProposalsPage` now loads `GET /admin/proposals/notice` and displays the
  matching count next to the filter buttons:
  - Open (submitted + judged)
  - In upload
  - Converted
- The counts update on page load; background polling of the proposal list is
  still active for the selected filter.

## 2026-07-14: Strengthen finalization guidance so agents never abandon in_upload proposals

- Updated `GET /howToPropose` workflow checks to state that
  `POST /proposals/{id}/finalize-upload` is mandatory and must be called even
  when validation reported findings or judgements failed.
- Added guidance to verify `uploadFinalized: true` in the next status response
  and to retry finalize once or delete the proposal instead of leaving it in
  `in_upload`.
- Added `cleanupEndpoint` and a `note` to the `uploadFinalization` section of
  `/howToPropose`.
- Updated public proposal status `nextStepForSubmitter` for `in_upload` to warn
  that the upload must be finalized or explicitly deleted; abandonment is not a
  valid workflow end state.

## 2026-07-14: Block auto-publish on skillId collision (new-version path)

- Extended `AutoPublishProposalUseCase` to block auto-publish when the submitted
  proposal targets an existing `skillId`. This path creates a new draft version
  of an existing skill, which is a deliberate human decision and must not be
  automated.
- Added `hasSkillIdCollision()` which reuses the existing
  `ProposalDuplicateCheckUseCase` and returns the existing `skillId`.
- Block reason is `manual_review_required` with a message explaining that the
  reviewer must decide between a new draft version or a new skill under a
  different id.
- Added unit test for the skillId collision gate.

## 2026-07-14: Define minimum public release scope; Authentik/OIDC as experimental preview

- Documented the public release stance: the default release profile uses
  `ADMIN_AUTH_MODE=simple` and static bearer agent authentication with agent-session
  delegation. OIDC and Authentik are code-complete but treated as **experimental / preview**
  for the first public release; real tenant acceptance is tracked as follow-up work.
- Added a "Minimum Public Release Path" checklist to `NEXT_STEPS.md` covering
  semantic duplicate gate verification, admin proposal badge, agent wording,
  judgement scenarios, publication-policy matrix, bearer fail-fast, SQLite backup/restore,
  and reverse-proxy basics.
- Kept the Authentik/OIDC preview checklist separate so operators can enable it
  explicitly without blocking the default release.
- Reduced LLM duplicate-check cost: semantic enrichment now runs only on heuristic
  matches with score >= 0.4, and at most on the top 3 candidates.

## 2026-07-14: LLM-based semantic duplicate gate, threshold 0.5, and clearer agent/status wording

- Changed `AUTO_PUBLISH_SIMILARITY_THRESHOLD` default from `0.7` to `0.5` in
  `apps/api/src/infrastructure/config.ts`, `.env.example`, and local `.env`.
- Extended `SkillJudgerPort` with an optional `assessDuplicateSimilarity` method
  and added a dedicated `duplicate-similarity-contract.ts` for the LLM prompt,
  Zod schema, and parser.
- Implemented `assessDuplicateSimilarity` in `VercelAiSdkSkillJudger` using
  `generateObject` and the configured model/timeout/retries.
- Enhanced `ProposalDuplicateCheckUseCase` with optional `SkillFileStoragePort`,
  `FileScannerPort`, and `SkillJudgerPort` dependencies. When a proposal ID is
  provided, the use case reads the submitted entrypoint content and the
  entrypoint content of top heuristic matches, then asks the LLM for a semantic
  similarity score between 0 and 1. The final score is the higher of the
  heuristic score and the LLM score, and the result includes an optional
  `semanticSimilarity` object with score, reason, compared file path, and model.
- Wired the enhanced use case into the container and made `AutoPublishProposalUseCase`
  pass the proposal ID to the duplicate check so the full content comparison runs.
- Updated auto-publish's `manual_review_required` reason for semantic duplicates
  to clearly name the candidate, the score, the threshold, and the need for a human
  decision.
- Improved agent-facing wording in `GET /howToPropose` and public proposal status
  responses so agents distinguish proposal states (`in_upload`, `submitted`, `judged`,
  `converted`, `rejected`) from skill states (`draft`, `in_review`, `approved`,
  `published`) and understand that auto-publish success means the skill version
  is public.
- Extended `SkillCatalogPort` with `countProposalsByStatus()` and implemented it in
  SQLite and MySQL catalogs. `ProposalReadUseCase.getNotice()` now returns a
  `counts` object with `in_upload`, `submitted`, `judged`, and `converted` in
  addition to `totalPending`.
- Updated the admin proposal badge in `Layout.tsx` to display
  `Open proposals (open/in_upload/converted)` with a hover tooltip showing the
  per-status breakdown, and added the corresponding i18n keys in English and
  German.
- Updated all relevant test stubs and tests; added new unit tests for the LLM
  duplicate enrichment and the semantic duplicate auto-publish gate.
- Verification: `npm run lint/typecheck/test` green for `apps/api` (432 tests)
  and `apps/web` (31 tests).

## 2026-07-14: Auto-publish semantic duplicate gate

- Added `AUTO_PUBLISH_SIMILARITY_THRESHOLD` (default 0.7) to `.env.example`.
- Wired `ProposalDuplicateCheckUseCase` into `AutoPublishProposalUseCase`.
- Auto-publish now runs the duplicate check before converting a proposal;
  if the best semantic match reaches the threshold, auto-publish is blocked
  with `manual_review_required` and a clear reason string.
- Added unit tests for blocked (0.85) and allowed (0.4) similarity scores.
- Local dev server runs with `JUDGER_PROVIDER=vercel-ai-sdk`,
  `AUTO_PUBLISH_ON_GREEN=true`, auth disabled, and unlimited agent sessions,
  ready for manual proposal/review UI testing.

## 2026-07-14: Vercel AI SDK auto-judge and auto-publish verified

- Fixed VercelAiSdkSkillJudger to use `generateObject` (native ai SDK v6 API)
  instead of the legacy `generateText` + `Output.object` combination.
- Fixed Zod schemas for judgement and auto-publish category responses so that
  nullable fields (skillPurposeSummary, matchedCategory) are required instead of
  optional. OpenAI rejects JSON schemas where a property is listed in
  `properties` but missing from `required`.
- Verified end-to-end with the user-provided OpenAI API key:
  - Proposal and file judgements complete with real LLM output from
    `vercel-ai-sdk:openai:gpt-4.1`.
  - `AUTO_PUBLISH_ON_GREEN=true` automatically converts and publishes a
    fully-green skill (`markdown-formatting-guide`).
  - The auto-published skill appears in public read endpoints and its package
    downloads successfully with an `AgentSession` code.
- Note: local `.env` is now configured with `JUDGER_PROVIDER=vercel-ai-sdk` and
  `AUTO_PUBLISH_ON_GREEN=true`; `OPENAI_API_KEY` is read from `.env.secrets`.
  Because the ambient shell environment sets `OPENAI_API_KEY=ollama`, the dev
  server must be started with an explicit override or the ambient value wins.

## 2026-07-14: End-to-end agent-session and proposal publication verification

- Verified the agent-session flow against the running local stack:
  - /discover advertises the frontend agent-session URL (port 3041).
  - Read-only sessions access /api/skills; proposal sessions access
    /api/proposals/check-duplicate.
  - Read-only sessions on proposal endpoints get a 401 with sessionAreas,
    agentSessionUrl, and a clear recommendation.
  - Combined read+proposal sessions cover both areas.
- Identified and published an existing but unreviewed skill
  (sample-integration) through the admin workflow so the agent can download it.
- Set AGENT_SESSION_MAX_ACTIVE=unlimited in local .env to avoid hitting the
  default 10-session cap during repeated agent-driven tests.
- Remaining: activate Vercel AI SDK judger for real auto-judge/auto-publish tests.

## 2026-07-14: Area-scoped agent-session errors and proposal actor resolution

- Extended `AgentAuthRequiredError` with the session areas it is valid for and
  the frontend agent-session URL.
- `ValidateAgentSessionUseCase` now distinguishes invalid/expired sessions
  from sessions that simply do not include the requested area.
- `AgentApiAuth` returns a 401 with `sessionAreas`, `agentSessionUrl`, and a
  human-readable recommendation when an agent uses a session that lacks the
  requested area (e.g. a read-only session on a proposal endpoint).
- `proposal.controller.ts` now resolves the proposal actor for
  `Authorization: AgentSession <code>` requests, so proposals submitted via
  agent sessions are attributed to `agent-session:<code>`.
- Added error-response tests for area-miss and plain agent-auth-required 401s.
- End-to-end verification: read-only sessions access read endpoints, are
  rejected from proposal endpoints with a clear area-miss message, proposal-only
  sessions access proposal endpoints, and combined sessions access both.

## 2026-07-14: Remove credential-setup script in favor of agent-session delegation

- Removed the `/agent-credentials/setup.sh` endpoint and the
  `credentialSetupScriptUrl` field from discovery, 401 error details,
  `/howToPropose`, and the frontend HowToPropose page.
- Agent-session delegation (`/frontend/agent-auth`) is now the single
  human-in-the-loop path for static bearer auth.
- Updated agent-facing bootstrap docs, acceptance checklists, and roadmap docs
  to describe the agent-session flow instead of the setup script.
- Updated OpenAPI spec and regenerated TypeScript types.
- Verification: `npm run lint`, `npm run typecheck`, and `npm run test` green
  for `apps/api`, `apps/web`, and `packages/openapi`.

## 2026-07-14: EPIC-012 Agent Session Delegation — Expose Frontend Agent-Auth URL in /discover

- The `/discover` response now advertises an absolute `url` in the
  `agent-session` auth scheme, pointing to the **frontend**
  `/frontend/agent-auth` endpoint instead of the API backend port.
- Rewrites `PUBLIC_API_BASE_URL` to the frontend origin when the API and UI
  ports differ (default: 3040 → 3041). If the configured API base URL ends in
  `/api`, that suffix is stripped so the link points to the human UI.
- Updated `instructions` to explicitly invite agents with an in-app browser,
  browser MCP, or similar tooling to open the page directly and notify the user
  that the auth page is ready, while still allowing the URL to be shown as a
  clickable link as a fallback.
- Updated `/howToPropose` workflow notes: when bearer auth is enabled and
  agent sessions are active, the first step now tells the agent to delegate
  access through the agent-auth page URL rather than the setup script.
- Added `instructions` and `url` to the `RuntimeAuthScheme` OpenAPI schema and
  regenerated TypeScript types.
- Added/updated tests to assert the rewritten frontend URL and to cover the new
  `/howToPropose` step title.
- Verification: `npm run lint`, `npm run typecheck`, and `npm run test` green
  for `apps/api`, `apps/web`, and `packages/openapi`.

## 2026-07-14: EPIC-012 Agent Session Delegation Implemented

- Implemented browser-based, human-in-the-loop agent session delegation as
  documented in `docs/roadmap/EPIC-012-agent-session-delegation.md`.
- Backend changes:
  - Added `agent_sessions` table to SQLite and MySQL catalog schemas.
  - Added `AgentSessionRepositoryPort` and SQLite/MySQL adapters.
  - Added use cases: create, validate, list, revoke.
  - Extended `AgentApiAuth` to accept `Authorization: AgentSession <code>`
    as a fallback after bearer validation, with cross-area isolation.
  - Added `POST /agent-sessions`, `GET /admin/agent-sessions`, and
    `DELETE /admin/agent-sessions/:code` to `AgentSessionController`.
  - Secured `POST /agent-sessions` so it requires a valid bearer token for each
    requested area via dedicated `X-Agent-*-Token` headers.
- Frontend changes:
  - Added public `/frontend/agent-auth` page with per-area token inputs,
    session code display, copy-to-clipboard, and usage instructions.
  - Added admin-only `/frontend/admin/agent-sessions` page with list,
    polling, and revoke action.
  - Updated router, layout navigation, and i18n messages (en/de).
- OpenAPI changes:
  - Added `agentSession` security scheme.
  - Added `/agent-sessions` and `/admin/agent-sessions` endpoints.
  - Added `AgentSession`, `AgentSessionListResponse`,
    `CreateAgentSessionRequest/Response` schemas.
  - Regenerated `packages/openapi/dist/skill-registry.d.ts`.
- Specs and tests:
  - Added co-located specs for controller, use cases, port, and adapters.
  - Added controller tests with in-memory repository.
  - Extended `agent-api-auth-matrix.test.ts` and `check-agent-auth-matrix.ts`
    to verify agent-session advertisement, authentication, and cross-area
    isolation.
- Docs:
  - Updated `docs/setup/ENVIRONMENT.md` with agent session variables.
  - Updated `docs/progress/NEXT_STEPS.md` and `CHANGELOG_INTERNAL.md`.
- Verification:
  - `npm run lint`, `npm run typecheck`, `npm run test` pass for all
    workspaces.
  - `apps/api` and `apps/web` production builds pass.
  - Most `./scripts/check.sh` integration scripts pass when run directly via
    `node --import tsx/loader.mjs`; the full `check.sh` wrapper is blocked in
    this sandbox by tsx IPC pipe/network listen restrictions.


## 2026-07-14: EPIC-012 Agent Session Delegation — Secure Session Creation

- Hardened `POST /agent-sessions` so it requires a valid bearer token for **each**
  area being delegated (`discovery`, `public-read`, `proposal`).
- Tokens are supplied in dedicated headers (`X-Agent-Discovery-Token`,
  `X-Agent-Read-Token`, `X-Agent-Proposal-Token`) so multiple area secrets can be
  proved in a single request without abusing the single `Authorization` header.
- Replaced the previous `agentAuth.guard('discovery')` pre-handler, which would
  have allowed a discovery bearer token (or no token at all when discovery was
  unprotected) to create read/proposal sessions.
- Added `validateAreaBearerToken` and `throwIfAreaBearerInvalid` to
  `AgentApiAuth` to keep constant-time token comparison inside the auth adapter.
- Rewrote `agent-session.controller.test.ts` with an in-memory fake repository to
  avoid a cross-directory vitest import issue and added tests for multi-area
  creation, missing/wrong area tokens, and disabled areas.
- Updated `docs/roadmap/EPIC-012-agent-session-delegation.md` to document the
  per-area header validation and the hardened endpoint contract.
- `apps/api` typecheck passes; the new controller test suite passes.


## 2026-07-14: Serve Discovery Inline At Frontend Root

- Changed the Vite dev-server root middleware (`apps/web/vite.config.ts`) to
  proxy `GET /` directly to `/api/discover` and return the JSON body inline,
  instead of issuing an HTTP `302` redirect to `/api/discover`.
- Agents can now bootstrap with a single `curl http://localhost:3041/` and
  receive the discovery document immediately, saving one redirect hop.
- The dev proxy still routes `/api/*` to the configured API base URL.
- Production builds are unaffected; `dist/index.html` remains the static SPA
  entry point.


## 2026-07-14: Static Bearer Setup-Script Flow Acceptance (AUTH-02)

- Added `setup-script-client-flow.test.ts`, an executable end-to-end test that
  downloads `/agent-credentials/setup.sh`, verifies it contains no server-side
  secrets, runs it in terminal mode, checks `~/.managed-skill-hub/credentials.json`
  permissions, and proves the saved read/proposal tokens authenticate the
  corresponding API areas.
- Ran the live flow against the local server with:
  - `PUBLIC_READ_AUTH_MODE=bearer`
  - `PROPOSAL_AUTH_MODE=bearer`
  - `DISCOVERY_AUTH_MODE=none`
  - separate read and proposal bearer tokens in `.env.secrets`.
- Verified discovery advertises `credentialSetupScriptUrl` and bearer schemes.
- Verified protected reads and proposals return `401` without credentials and
  `200`/`201` with the correct token.
- Verified cross-area isolation: read token rejected on proposal routes and
  proposal token rejected on read routes.
- Recorded the result as AUTH-02 PASS in
  `docs/setup/AUTHENTICATION_ACCEPTANCE_CHECKLIST.md` with sanitized evidence
  under `.tmp/auth-acceptance/auth-2026-07-14-03-AUTH-02/`.
- Fixed `scripts/check-public-release-hygiene.sh` to handle multiple matching
  ignored files per glob, preventing false failures when several
  `docs/setup/*INTERNAL*.md` files exist.
- Restored `.env` and `.env.secrets` to the previous local dev profile after the
  test. Kept a non-public record of the exact bearer-test profile in
  `docs/setup/AUTHENTIK_INTERNAL_NOTES.md`.


## 2026-07-14: Production Readiness Verification Handoff

- Added an executable production-readiness handoff covering automated gates,
  mixed and OIDC auth profiles, real Authentik activation, custom-judger failure
  and retry cases, publication policies, runtime safety, and evidence rules.
- Recorded the restricted-sandbox restart caveat and the required clean host
  restart/runtime verification without exposing secret material.

## 2026-07-14: Proposal Status Guidance Correction

- Made public `adminOnlyNextSteps` status-dependent so converted, rejected, and
  approved proposals no longer advertise stale conversion or rejection work.
- Kept administrative cleanup guidance for incomplete uploads and review
  guidance for submitted/judged proposals, with regression coverage for every
  proposal lifecycle status.

## 2026-07-14: custom-provider Judger Acceptance And Published Read Proof

- Accepted JUDGE-03 against the real custom-provider custom adapter with persisted
  proposal and file results across restart.
- Verified conversion, submit-review, approval, and publication of
  `sample-custom-judger-skill@1.0.0`; every lifecycle mutation returned `200` and
  conversion produced successful skill-version and file judgement events.
- Verified the published detail and package through configured bearer auth,
  preserved the original 21,848-byte `SKILL.md` with `HTTP/1.1`, and confirmed
  anonymous protected reads still return `401`.
- Retained JUDGE-05 and JUDGE-06 as pending because their retry, failure,
  alternate-policy, override, and independent-role branches are not yet proven.

## 2026-07-14: Proposal Background Refresh

- Added a shared abortable, non-overlapping 10-second frontend polling hook.
- Applied background refresh to the open-proposal navigation count, admin
  proposal list, admin proposal detail, and public proposal status page.
- Preserved rendered data, selection, expansion, scroll, and other local UI
  state during background requests so refreshes do not produce loading flicker.
- Extended the deterministic admin UI smoke proof with polling interval,
  request cancellation, and route coverage checks.

## 2026-07-14: Protected Catalog Browser Access And Reference Validation

- Allowed valid admin browser sessions with `reader` or `admin` to satisfy
  protected published-read routes without storing agent bearer/OIDC tokens in
  the frontend; discovery and proposal authentication remain independent.
- Added route-boundary coverage for reader/admin, reviewer-only, invalid, and
  discovery-session cases and documented the OpenAPI `adminSession` alternative.
- Excluded HTTP protocol version labels such as `HTTP/1.1` from proposal package
  path detection while preserving normal missing-artifact validation.
- Recorded the successful local custom-provider proposal/file judgement observation
  and the required post-restart browser retest.

## 2026-07-14: Explicit Judgement State And Publication Safety

- Added proposal-level and per-file execution states derived from persisted
  judgements and failure audit events.
- Corrected finalize-upload responses so unavailable, failed, and partial runs
  are not reported as completed.
- Added stored proposal-file judgement retry and preserved converted/rejected
  proposal states during re-judgement.
- Added structured judgement runtime events and safe provider error responses.
- Added `PUBLISH_JUDGEMENT_POLICY=disabled|warn|required`, required-mode missing
  target checks, and audited administrator override reasons.
- Exposed converted draft lifecycle controls, proposal/file retry controls, and
  explicit no-result states in the admin skill workbench.
- Added OpenAPI coverage, environment examples, co-located spec updates, and a
  manual judgement/publication acceptance checklist.

## 2026-07-14: Authentication Acceptance Run AUTH-00

- Recorded the local automated baseline as passing on commit `7d96823`:
  repository checks, deterministic auth/OIDC proofs, production builds, and
  dependency audit completed successfully with zero known vulnerabilities.
- Ran the optional MySQL full gate against the configured local MySQL profile;
  every implemented gate completed successfully.
- Recorded a sanitized `AUTH-01` API pretest covering public routes, simple
  admin login/session/logout, protected routes, and the reviewer badge. Browser
  and disposable-upload acceptance remains operator-driven.

## 2026-07-13: Layered Runtime Configuration And Secrets

- Split non-secret runtime configuration (`.env`) from local secret material
  (`.env.secrets`) with process-environment-first precedence across API, web
  build/dev, restart, smoke, backup, and restore entrypoints.
- Added a blank secret inventory and a value-redacting migration tool that
  moves legacy secret assignments and appends missing non-secret config keys.
- Removed secret assignments from all agent-editable auth profile templates and
  documented secret-manager ownership, migration, and deployment handling.

## 2026-07-13: Authentik Security Review Remediation

- Added an agent-handoff authentication acceptance checklist covering the
  automated 27-mode baseline plus simple, bearer, OIDC, mixed-mode, role,
  ownership, token-class, provider-outage, and rollback staging scenarios.
- Replaced the staging gate's reject-only ID-token check with independent OIDC
  signature, issuer, audience, expiry, issued-at, type, authorized-party, and
  same-subject validation before testing access-token rejection.
- Added constant-time `at_hash` verification and schema-v2 operator evidence for
  same-Token-Endpoint-response provenance when OIDC-valid ID tokens omit that
  optional claim.
- Corrected the deterministic provider proof to select `jwt_profile` explicitly
  and validate a realistic `typ=JWT` ID token with `at_hash` before rejecting it
  as an API credential.
- Replaced permissive Authentik `typ=JWT` acceptance with two explicit modes:
  strict RFC 9068 `at+jwt`, or local JWT validation plus authenticated
  Authentik introspection with exact active/client/subject checks.
- Enforced strong production static bearer lengths and rejected example
  secrets; bounded session, clock, transaction, JWKS, timeout, token, group,
  and password-login limiter settings.
- Replaced post-buffer provider response checks with incremental stream limits
  that cancel discovery, JWKS, token, and introspection bodies immediately on
  overflow.
- Moved the administrator proposal badge to a reviewer-protected admin endpoint
  and added in-process simple-login throttling with bounded client buckets.
- Removed unconditional anonymous `{}` entries from OpenAPI security arrays and
  documented runtime `none|bearer|oidc` selection through a root extension.
- Made trusted cross-issuer first-login projection converge on a deterministic
  tenant/subject principal ID, including simultaneous-login regression tests.
- Documented that `none` has no verified owner identity, static bearer has one
  shared actor, and protected public catalog browsing needs a distinct future
  browser OIDC flow.

## 2026-07-13: Authentik/OIDC Runtime And Deterministic Gates

- Implemented independent `simple|oidc` admin auth and all 27
  `none|bearer|oidc` discovery/read/proposal combinations without removing
  open or static bearer compatibility.
- Added server-side Authorization Code plus PKCE, one-time state/nonce
  transactions, opaque local sessions, role snapshots, revocation, strict
  cookies, safe return paths, and role-aware admin UI commands.
- Added strict Authentik access-token validation with exact issuer, audience,
  `azp`, `uid`, scopes, time, asymmetric JWKS signatures, human policy, bounds,
  unknown-key rotation, fail-closed outage handling, and ID-token rejection.
- Added JIT principals, stable proposal owner/client attribution, additive audit
  fields, privacy-safe status, two-human access rules, and stable-principal rate
  limiting across SQLite/MySQL and filesystem/database-content modes.
- Added redacted auth/security events, explicit OpenAPI security alternatives,
  Device Authorization discovery/how-to guidance, configurable UI return paths,
  session-expiry messaging, and reviewer/publisher/admin action visibility.
- Removed concrete-class `instanceof` coupling from admin route registration,
  constrained admin discovery endpoints to the trusted issuer origin, and
  corrected simple-session cookie `Max-Age` units.
- Added deterministic local OIDC/JWKS, 27-mode, OpenAPI, UI-role, provider,
  content, ownership, rotation, and outage proofs. Full SQLite/MySQL, cutover,
  rollback, build, test, and dependency-audit gates pass.
- Added the optional real Authentik staging gate with short-lived live token
  validation and fresh anonymous evidence for browser, two-human, role,
  rotation/outage, and rollback checks. Production activation remains pending
  that deployment-specific gate, so the Authentik profile warning remains.

## 2026-07-13: Authentik/OIDC Target Playbooks

- Accepted ADR-015 for independently configurable Authentik OIDC admin,
  discovery, published-read, and proposal authentication modes.
- Defined human-delegated agent proposal identity through OAuth Device
  Authorization, with all active interactive Authentik users allowed to submit
  and read status by known UUID by default.
- Added complete `.env.example.simple` and target-only
  `.env.example.authentik` profiles with explicit implementation status.
- Added the Authentik operator setup/cutover/rollback playbook and the normative
  agent Device Flow guide.
- Linked the target contract from setup, deployment, architecture, roadmap,
  agent bootstrap, operations, and documentation indexes without claiming that
  OIDC runtime support is already implemented.
- Added EPIC-011 with implementation phases, identity/session ports, additive
  migration, protocol and authorization tests, rollout, rollback, and complete
  acceptance criteria for the Authentik target.

## 2026-07-13: Public Release Baseline

- Reduced the public judger boundary to provider-neutral adapter selection;
  custom adapters now own and parse their provider-specific configuration.
- Kept local custom adapter implementations, diagnostics, private environment
  examples, and deployment helpers outside the public Git snapshot through
  explicit ignore rules.
- Removed private service references, private conversation links, and internal
  product wording from public code, tests, templates, and documentation.
- Extended the public-release hygiene proof to inspect commit candidates,
  ignored tracked files, and all reachable Git history for private paths and
  references.
- Prepared a clean single-root public history after creating and verifying a
  full local project backup.

## 2026-07-13: Release Review Remediation

- Declared and locked the `mysql2` runtime dependency so clean installs can run
  all MySQL catalog, search, and database-content paths.
- Replaced process-global MySQL transaction state with async-context-local
  connections and serialized SQLite operations around async transactions,
  preventing concurrent requests from joining or interleaving transactions.
- Replaced PPTX extraction through LiteParse/LibreOffice with deterministic
  in-process OOXML extraction without an external fallback, including empty and
  invalid presentations, and bounded remaining third-party parser calls with a
  timeout.
- Enforced proposal submitter ownership for public metadata updates, file
  replacements, validation, finalization, and deletion. Added explicit `403`
  contracts for cross-actor mutations.
- Kept administrative cleanup separate from submitter commands: admins can
  delete abandoned `in_upload` proposals, while finalized/converted proposals
  remain state-protected.
- Shared one proposal limiter across root and `/api` route aliases. At bucket
  capacity, new identities now receive `429` instead of evicting active buckets
  and resetting an existing identity's effective limit.
- Extended pull-request CI with production build, lockfile audit, and the full
  Docker/MySQL validation gate.
- Added focused transaction, scanner, ownership, route-alias rate-limit, and
  lifecycle regression coverage plus updated co-located specs.

## 2026-07-13: Proposal API Security Gates

- Added production startup fail-fast for `PROPOSAL_AUTH_MODE=none`; production
  deployments must use bearer proposal auth unless
  `ALLOW_OPEN_PROPOSALS_IN_PRODUCTION=true` is explicitly set for intentionally
  open internal deployments.
- Added dependency-free in-memory rate limiting for all proposal routes. Limits
  are keyed by authenticated proposal bearer actor when bearer auth is enabled
  and by request IP otherwise.
- Added `PROPOSAL_RATE_LIMIT_WINDOW_MS` and
  `PROPOSAL_RATE_LIMIT_MAX_REQUESTS` configuration.
- Added `PROPOSAL_RATE_LIMIT_MAX_BUCKETS`, lazy expired-bucket cleanup, and
  capacity rejection for new identities so high-cardinality traffic cannot grow
  process memory or reset active identities through bucket eviction.
- Added `API_TRUSTED_PROXIES`; forwarded client IPs are accepted only from an
  explicit proxy IP/CIDR allowlist.
- Replaced native `bcrypt` with `bcryptjs` for admin password hash checks,
  removing the `@mapbox/node-pre-gyp`/`tar` dependency chain from the lockfile.
- Consolidated API tests on the declared `vitest` 3 line and removed the stale
  invalid `vitest` 4 workspace installation.
- Migrated Fastify and all coupled plugins to the Fastify 5-compatible line,
  the built-in judger to AI SDK 6/OpenAI provider 3, and the web build to Vite
  6.4.3.
- Updated the Vercel AI SDK judger to the stable structured `output` contract.
- Reduced `npm audit --audit-level=moderate --package-lock-only` from 13
  vulnerabilities to zero.
- Declared `tsx` as a root proof-script dependency and regenerated the lockfile
  from an empty install context so platform-specific optional `esbuild`
  binaries remain reproducible across macOS, Linux, and Windows.
- Removed hard-coded workspace `node_modules` paths from proof scripts.
- Repaired the OpenAPI production build by using `JudgementListResponse` for
  public judgement lists and documenting proposal creation under HTTP `201`.
- Added nginx request/connection/body-size limits and corrected deployment/test
  password-hash examples to use `bcryptjs`.
- Updated OpenAPI, environment/deployment docs, specs, and NPM verification
  notes for the new proposal security gates.

## 2026-07-13: Agent Pre-Upload Package Proof

- Hardened `/howToPropose` so agents must build, scan, normalize, and hash the
  final temporary upload package before `POST /proposals`.
- Added machine-readable `preUploadPackageProof` guidance with minimum
  reference patterns and forbidden network writes before local proof.
- Updated Agent Bootstrap, OpenAPI examples, testing guidance, and agent
  contract proof coverage so server-side `validate-upload` is treated as a
  final check rather than the first path/reference scanner.

## 2026-07-13: Portable Agent Command Artifact Planning

- Added EPIC-010 to plan a portable `commands/` package convention for agent
  command shortcuts across Cursor, Codex, Claude Code, and generic runtimes.
- Documented the desired upload behavior for outside-root command references:
  copy relevant command files into the skill package, rewrite references to
  package-relative paths, and leave only truly historical command references as
  non-blocking warnings.
- Implemented first-stage portable command upload validation: runtime-specific
  command references now return `portable_command_*` findings with
  package-relative `commands/` suggestions, existing command folders are
  preserved, missing command manifests are non-blocking warnings, and manifest
  `source` inconsistencies are reported without blocking finalization.

## 2026-07-13: In-Upload Proposal File Replacement

- Upload validation findings are now structured with `kind`, `severity`,
  `blocksFinalize`, `file`, `line`, `candidate`, and
  `suggestedReplacement`.
- Finalize-upload validation failures now return the full structured findings
  list through `details.findings` instead of truncating the response.
- Documentation-only external references such as `CursorProjects/...` and
  `.cursor/commands/...` are non-blocking warnings, while `.cursor/skills/...`
  package references remain blocking until normalized or included.
- Proposal review risk summary now uses the highest observed proposal/file
  judgement risk instead of the last-written judgement risk.
- Added `POST /proposals/{id}/validate-upload` so agents can receive all
  package-reference findings before finalization without extraction, judgement,
  status changes, or finalize side effects.
- Validate-upload findings now include `file:line: message` locations, and
  variable placeholder runtime-output examples such as
  `{output}/screenshots/{name}.png` no longer hard-block upload finalization as
  missing package files.
- Added public `DELETE /proposals/{id}` for aborting proposals that are still
  `in_upload`; public deletion after finalization remains blocked.
- Proposal file upload now behaves as an upsert by relative path while a
  proposal is still `in_upload`.
- Public proposal metadata can now be patched while a proposal is still
  `in_upload`, allowing submitters to correct title, description, category,
  tags, capabilities, or entrypoint before finalization.
- Submitter-side post-check corrections can replace an already uploaded file
  or correct metadata without creating a second proposal.
- Agent guidance, OpenAPI descriptions, and concurrency/abuse proof coverage
  document and validate the replacement behavior.

## 2026-07-12: Proposal Timestamp Source-Of-Truth Hardening

- MySQL catalog reads now parse stored UTC `DATETIME` values deterministically
  instead of relying on local-process timezone interpretation.
- Proposal command use cases load the repository aggregate before catalog
  fallback so stale read projections cannot overwrite source-of-truth fields
  such as `createdAt` during attach, finalize, reject, convert, or auto-publish
  flows.
- Regression tests cover repository-first proposal loading when catalog
  projection timestamps disagree with the source aggregate.

## 2026-07-12: Security Review Hardening

- Added configured CORS origin allowlisting and admin mutation Origin/Referer
  validation.
- Added production fail-fast checks for default/short JWT secrets, plaintext
  admin passwords, missing admin password hashes, and wildcard CORS origins.
- Hardened artifact responses with `nosniff`, sandbox CSP, and attachment
  delivery for active browser content types.
- Added filesystem storage path containment, public file-read manifest
  validation, and unsafe tar-member rejection before restore.
- Documented the remaining public-release risks around dependency audit
  remediation and proposal rate limits/quotas.

## 2026-07-12: EPIC-009 Database-Backed Content Storage Planning

- Completed EPIC-009 lifecycle coverage with global audit enumeration, filesystem-to-database migration of global audits, database-to-filesystem export, export proof coverage, and MySQL database-content backup guard proof.
- Documented the EPIC-009 completion recommendation, including two-way storage lifecycle, cutover/rollback guidance, and backup-mode responsibilities.
- Added copy-only `scripts/migrate-content-to-database.ts` plus `scripts/check-content-migration.ts` to prove scoped filesystem-to-database migration for skills, proposals, files, extracts, and skill/proposal audit entries.
- Extended EPIC-009 database-backed content storage to MySQL provider mode and wired MySQL content-storage parity into `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh`.
- Implemented first-stage EPIC-009 SQLite database-backed content storage with `CONTENT_STORAGE_PROVIDER`, database-backed repository/file/audit adapters, SQLite catalog metadata bridging, and `scripts/check-content-storage-matrix.ts` black-box parity proof.
- Documented EPIC-009 recommended decisions: content storage follows `CATALOG_PROVIDER`, audit is DB-backed in database mode, observability remains telemetry, MySQL `backup.sh` fails fast, filesystem export is required, and DB BLOBs stay within current limits initially.
- Added `docs/roadmap/EPIC-009-database-backed-content-storage.md` with current-state analysis, affected files, risks, migration concerns, backup/restore implications, and deterministic proof expectations for `CONTENT_STORAGE_PROVIDER=database`.
- Linked EPIC-009 from the master plan and documentation index.

## 2026-07-11: EPIC-008 CI And Release Gate Wiring

- Hardened `scripts/full-check.sh` so a missing provider matrix script is a full-check error instead of a stale planning notice.
- Added `.github/workflows/validation.yml` with a lightweight pull-request/push check and a scheduled/manual Docker/MySQL full validation gate.
- Documented CI proof artifact retention for `.tmp/*.log` and `.tmp/*.json` in the testing guide and EPIC-008.
- Marked EPIC-008 as implemented while keeping future browser-E2E and smoke-gate policy review as follow-up options.

## 2026-07-11: Admin UI Smoke Proof

- Added `scripts/check-admin-ui-smoke.ts` and its co-located spec to prove public route exposure, admin route guarding, authenticated admin navigation, login/logout wiring, config-aware setup UI, not-judged display, and proposal review/draft reachability.
- Wired the lightweight source-contract proof into `./scripts/check.sh` and documented `.tmp/admin-ui-smoke.*` artifacts.

## 2026-07-11: Provider Cutover Proof

- Added `scripts/check-provider-cutover.ts` and its co-located spec to prove SQLite baseline creation, MySQL projection rebuild parity, post-cutover write visibility, and restart-script MySQL preflight behavior.
- Wired the proof into the `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` path and documented `.tmp/provider-cutover.*` artifacts.

## 2026-07-11: Provider Matrix Proof

- Added `scripts/check-provider-matrix.ts` and its co-located spec to prove public read parity for provider-backed catalog/search combinations.
- Wired the infrastructure-free `sqlite/sqlite` subset into `./scripts/check.sh`; the full SQLite/MySQL matrix runs through `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh`.
- The proof writes `.tmp/provider-matrix.*` artifacts and terminates after all selected provider cases pass.

## 2026-07-11: Backup And Restore Proof

- Added `scripts/check-backup-restore.ts` and its co-located spec to prove backup archive creation, restore completion, restored skill/proposal/audit/projection data, and pre-restore safety copies against isolated data.
- Hardened `backup.sh`/`restore.sh` for deterministic proof runs with `MSH_SKIP_ENV=true`; `restore.sh` also supports `MSH_SKIP_STOP=true` and preserves backup archives located under `DATA_DIR` before moving current data aside.
- Wired the proof into `./scripts/full-check.sh` and documented the generated `.tmp/backup-restore.*` artifacts.

## 2026-07-11: Observability And Audit Proof

- Expanded `scripts/check-observability-audit.ts` to cover admin proposal conversion, skill publish, proposal rejection, projection rebuild, and their file-backed audit entries.
- Added `scripts/check-observability-audit.ts` and its co-located spec to prove deterministic observability counters, proposal-scoped recent requests, JSON/CSV exports, and file-backed audit entries.
- Wired the proof into `./scripts/check.sh` and documented the generated `.tmp/observability-audit.*` artifacts.

## 2026-07-11: Proposal Lifecycle Proof

- Expanded `scripts/check-proposal-lifecycle.ts` to cover deterministic similar duplicate candidates, broken local-reference finalization blocking, proposal/file judgement creation, admin publish, admin rejection, and state-blocked delete behavior.
- Added `scripts/check-proposal-lifecycle.ts` and its co-located spec to prove how-to guidance, duplicate precheck, proposal creation, blocked dependency uploads, upload finalization, public status, admin conversion, and draft non-public visibility against real Fastify routes and an isolated SQLite-backed `.tmp` data directory.
- Wired the proof into `./scripts/check.sh` and documented the generated `.tmp/proposal-lifecycle.*` artifacts.

## 2026-07-11: Concurrency And Abuse Proof

- Expanded `scripts/check-concurrency-abuse.ts` to cover duplicate upload rejection, HTTP file count and file size boundaries, and concurrent projection rebuild stability.
- Hardened proposal uploads so duplicate relative file paths return a clean validation error instead of surfacing as storage/projection failures.
- Added `scripts/check-concurrency-abuse.ts` and its co-located spec to prove repeated proposal state transitions fail safely and malformed package paths are rejected.
- Hardened skill package downloads to normalize and reject unsafe package file paths before direct download or ZIP creation.
- Wired the proof into `./scripts/check.sh` and documented the generated `.tmp/concurrency-abuse.*` artifacts.

## 2026-07-11: Skill Package Download Proof

- Added `scripts/check-skill-package-downloads.ts` and its co-located spec to prove direct `SKILL.md` downloads, multi-file ZIP downloads, draft-version blocking, and unknown-skill 404 behavior for published skill package consumption.
- Wired the proof into `./scripts/check.sh` and documented the generated `.tmp/skill-package-downloads.*` artifacts.

## 2026-07-11: Judger Auto-Publish Matrix Proof

- Added `scripts/check-judger-autopublish-matrix.ts` and its co-located spec to generate deterministic proof artifacts for noop, explicit auto-approval, real green, risky, classifier-blocked, classifier-failed, and missing-classifier auto-publish behavior.
- Wired the proof into `./scripts/check.sh` and documented the generated `.tmp/judger-autopublish-matrix.*` artifacts.

## 2026-07-11: EPIC-008 Lightweight Proof Infrastructure

- Fixed auto-publish handling so `AUTO_APPROVE_WITHOUT_JUDGER=true` explicitly permits `no_judge_available` noop judgements while non-green real judgements remain blocked.
- Added deterministic proof scripts for agent contract consistency, OpenAPI parity, and public release hygiene.
- Wired the implemented EPIC-008 lightweight proofs into `./scripts/check.sh` with `.tmp/*.log` and `.tmp/*.json` artifacts.
- Added `scripts/full-check.sh` as the extended validation entrypoint for optional smoke and MySQL gates.
- Normalized OpenAPI agent-facing responses so protected discovery, public-read, and proposal routes document `401` and usable success responses.
- Hardened the public custom-judger boundary and replaced provider-specific test
  aliases with generic adapter fixtures.

## 2026-07-11: EPIC-008 Deterministic Validation Planning

- Added `docs/roadmap/EPIC-008-deterministic-validation-and-release-proofing.md` to plan script-driven proof artifacts for provider parity, judger/auto-publish behavior, proposal lifecycle, skill downloads, agent contracts, public-release hygiene, backup/restore, and OpenAPI parity.
- Linked EPIC-008 from the master plan, documentation index, and next steps.
- Expanded EPIC-008 with fixture strategy, admin UI proof, observability/audit proof, provider cutover proof, concurrency/abuse proof, and CI/release gate expectations.

## 2026-07-11: Agent API Auth Matrix Coverage

- Added automated matrix coverage for all `PUBLIC_READ_AUTH_MODE`, `PROPOSAL_AUTH_MODE`, and `DISCOVERY_AUTH_MODE` `none`/`bearer` permutations.
- Added `docs/setup/AGENT_API_AUTH_TEST_MATRIX.md` with expected API, UI, 401, and setup-script behavior for each permutation.
- Linked the matrix from the setup testing guide and docs index.
- Added `scripts/check-agent-auth-matrix.ts` and `scripts/check-agent-auth-matrix.spec.md`; `./scripts/check.sh` now writes `.tmp/agent-auth-matrix.log` and `.tmp/agent-auth-matrix.json` as deterministic validation artifacts.

## 2026-07-11: EPIC-007 Static Bearer Auth Implementation

- Implemented `AgentApiAuth` for runtime-configurable `none`/`bearer` auth on discovery, public-read, and proposal route groups.
- Added registry identity/base URL config and exposed non-secret auth metadata through `/discover` and `/howToPropose`.
- Added `/agent-credentials/setup.sh`, a no-secret setup script generator for per-registry local consumer credentials.
- Updated OpenAPI, `.env.example`, setup/deployment docs, agent bootstrap guidance, and co-located HTTP specs for the implemented auth contract.
- Added tests for config parsing, bearer guard behavior, protected public-read/proposal routes, actor derivation, discovery metadata, and setup script redaction.

## 2026-07-11: EPIC-007 Configurable Agent API Authentication Plan

- Added `docs/roadmap/EPIC-007-configurable-agent-api-auth.md` for optional
  bearer authentication on public read, proposal, and discovery route groups.
- Linked EPIC-007 from the master plan, documentation index, and next steps so
  future auth work has a concrete implementation plan.
- Added agent token handling and bootstrap template requirements: agents should
  read tokens from local env/secret stores and never embed bearer tokens in
  generated scripts or conversations.
- Refined EPIC-007 toward consumer-friendly credential setup outside the agent
  conversation: PMs should be able to paste bearer tokens into a small setup UI
  or tool that stores user-global credentials, with OAuth/OIDC as a later path.
- Added the planned downloadable setup script flow: the server can generate a
  no-secret `setup.sh` with deployment URL and prompts derived from active auth
  configuration.
- Simplified EPIC-007 by folding proposal status auth into `PROPOSAL_AUTH_MODE`
  instead of introducing a separate status token/scope.
- Extended EPIC-007 for multi-instance consumers: credentials are stored and
  selected per registry alias/base URL so users can work with local, sandbox, and
  production ManagedSkillHub instances in parallel.

## 2026-07-11: Agent-Findable Setup And Provider Runbooks

- Clarified the README value proposition around governed skill reuse, agent
  consumption, proposal submission, duplicate preflight, admin review, and
  auto-publish.
- Updated `docs/product/AGENT_BOOTSTRAP.md` to state the agent/admin/automation
  publication boundary and duplicate-check responsibilities more explicitly.
- Linked environment, judger adapter, deployment, and agent operations docs from
  `AGENTS.md`, README files, and `docs/index.md` so new agent sessions can find
  setup guidance without repository-wide searching.
- Extended `docs/product/AGENT_OPERATIONS.md` with judger provider profiles for
  `noop`, `vercel-ai-sdk`, and custom adapter loading.
- Added server-side SQLite/MySQL provider guidance to `docs/setup/DEPLOYMENT.md` and
  documented the boundary for future database providers.
- Added `docs/howTo/README.md` as a task-oriented index for setup, runtime
  providers, judger adapters, and server operation guides.

## 2026-07-10: Local MySQL Runbook And Startup Hardening

- Added `scripts/start-mysql-stack.sh` readiness checks for TCP connectivity after
  compose start to reduce bootstrap race conditions.
- Updated `scripts/restart-all.sh` to preflight local MySQL connectivity when
  `CATALOG_PROVIDER=mysql` or `SEARCH_PROVIDER=mysql` is configured, so startup
  exits with actionable guidance instead of silent frontend `Network Error` fallout.
- Revised `docs/product/AGENT_OPERATIONS.md` to document the repository compose
  stack and phpMyAdmin troubleshooting for stale container hostnames (for example,
  `stale-mysql-container`).

## 2026-07-10: Public Release Metadata And Judger Documentation Cleanup

- Kept `.env.example` focused on provider-neutral public defaults and documented
  custom adapter configuration through `JUDGER_ADAPTERS.md`.
- Updated public environment and testing docs to avoid provider-specific custom
  judger defaults or endpoints in the standard setup workflow.
- Added project metadata files for open-source publishing: `LICENSE`, `NOTICE`,
  `CONTRIBUTING.md`, `SECURITY.md`, and `CODE_OF_CONDUCT.md`.
- Updated top-level docs index and status notes to reflect the public/internal
  judger guidance.

## 2026-07-09: EPIC-006 MySQL Support And Relational Provider Decoupling

- Added provider-independent wiring for catalog and search:
  `CATALOG_PROVIDER` and `SEARCH_PROVIDER`.
- Added MySQL provider adapters for catalog and search with explicit schema
  runners (`mysql.catalog-schema.ts`, `mysql.search-schema.ts`), plus tests.
- Added provider-safe search ranking normalization and relational tag filtering
  semantics in MySQL.
- Added full projection rebuild flow (`RebuildProjectionsUseCase`) and admin route
  `POST /admin/projections/rebuild` to migrate from primaries.
- Added operational migration and startup validation coverage for MySQL provider
  combinations in config.
- Added missing `MysqlSkillCatalog.spec.md` to keep adapter contracts documented.

## 2026-07-09: EPIC-006 MySQL Support And Relational Provider Decoupling Plan

- Added `EPIC-006` as the implementation plan for clean MySQL support without
  breaking the current hexagonal boundaries.
- The epic explicitly separates catalog provider and search provider decisions,
  requires provider-neutral search score semantics, and defines a rebuild-based
  migration path from filesystem/audit primaries instead of SQL-copy-based
  migration.
- The epic also defines full feature-parity as a hard requirement for public
  reads, admin workflows, proposal/judgement visibility, repeated tag filters,
  fuzzy fallback search, and version-resolution behavior.

## 2026-07-09: Public Tag Discovery And Multi-Tag Filtering

- Added `GET /tags` as a public discovery endpoint that lists tags from the
  latest published skill versions for agent and UI exploration.
- `GET /skills` and `GET /skills/search` now accept repeated `tag` query
  parameters and treat them as an AND filter across published skill metadata.
- Updated `/discover`, `/howToPropose`, OpenAPI, and the agent bootstrap guide
  so local agents can inspect current tags before choosing proposal metadata
  and can use multi-tag filtering during exploration.
- The public search UI now loads available tags, lets users combine them with
  category/query filters, and sends the same repeated `tag` parameters as the
  API contract.
- Verification:
  - `npm run test --workspace=apps/api -- src/adapters/inbound/http/skill-read.controller.test.ts src/application/usecases/skill/skill-query.adapter.test.ts src/adapters/outbound/catalog/sqlite/sqlite.skill-catalog.test.ts src/adapters/outbound/search/sqlite/sqlite.search.test.ts`
  - `npm run typecheck --workspace=apps/api`
  - `npm run typecheck --workspace=apps/web`
  - `git diff --check`

## 2026-07-09: Proposal Finalization Extracts And Reference Integrity

- `finalize-upload` now runs a deterministic reference-integrity check over
  readable proposal files and rejects outside-root workspace, IDE, agent,
  command, or generated-output references when they do not match the uploaded
  package structure.
- `finalize-upload` now persists extracts for every extractable proposal
  artifact before file judgements run, so `.pptx` and similar binary artifacts
  immediately expose extracted content in the UI and are judged on that
  extracted text.
- Added regression coverage for stale path rejection and finalize-time extract
  persistence before file judgement.

## 2026-07-09: Proposal Upload Preserves Relative Subfolders

- `POST /proposals/{id}/files` now accepts an optional multipart `path` field
  and uses it as the relative in-package artifact path instead of always
  flattening to the uploaded filename.
- Proposal uploads can now preserve meaningful subfolders such as `scripts/`,
  `templates/`, `docs/`, `examples/`, `assets/`, and `prompts/` when the
  submitter agent sends the intended relative path.
- `GET /howToPropose`, OpenAPI, and the agent bootstrap guide now state
  explicitly that local agents should preserve meaningful folder structure and
  keep relative references valid from `SKILL.md` and moved artifacts.
- Added HTTP regression tests for explicit multipart `path` handling and
  filename fallback.

## 2026-07-09: Agent Contract For Required Local Artifacts

- Tightened `GET /howToPropose` so submitter agents must actively infer which
  local artifacts a skill depends on instead of treating non-code files as
  optional by default.
- Clarified the distinction between excluded dependency trees and required
  local runtime artifacts such as templates, prompts, fixture data, example
  manifests, images, PDFs, and PPTX files.
- Added an explicit stop rule: if a referenced local artifact is missing or the
  agent cannot justify omitting it as an external prerequisite, the agent must
  stop before upload.
- Updated the agent bootstrap guide and controller spec/tests to keep this
  requirement machine-readable and regression-covered.

## 2026-07-09: EPIC-005 Proposal Upload Finalization And Auto-Publish Plan

- Added `EPIC-005` as the implementation plan for explicit proposal
  upload-finalization, hard env-configured proposal upload limits, disallowed
  dependency-tree paths, and optional auto-publish on fully green finalized
  proposals.
- The epic also fixes the product decision that proposals start in `in_upload`
  and require an explicit submitter-agent finalization step before judgement and
  any automation may run.

## 2026-07-09: EPIC-005 Upload Finalization Slice

- Proposal creation now opens an `in_upload` workflow state instead of
  immediately submitting and judging the proposal.
- `POST /proposals/{id}/files` now enforces env-backed hard limits for file
  count, per-file size, and blocked dependency-tree path prefixes.
- `POST /proposals/{id}/finalize-upload` explicitly closes the upload package,
  moves the proposal to `submitted`, and only then starts proposal/file
  judgements.
- `GET /howToPropose`, public proposal status, OpenAPI, env examples, and
  agent bootstrap/testing docs now describe the finalized upload contract.

## 2026-07-09: EPIC-005 Auto-Publish Completion

- Added `AutoPublishProposalUseCase` to evaluate finalized proposals for
  automatic convert/review/publish based on:
  - duplicate/manual blockers,
  - fully green proposal and file judgements,
  - excluded-category classifier output.
- Added provider-neutral auto-publish category prompt/output contract and
  wired it into noop, custom judger, and Vercel AI SDK judger adapters.
- Finalize-upload now returns auto-publish outcome metadata, and public/admin
  proposal reads expose automation state and blocker reasons.
- Admin proposal lists now include a dedicated `in_upload` filter, and proposal
  detail/status pages surface upload completion plus auto-publish context.
- Verification:
  - `npm run typecheck --workspace=apps/api`
  - `npm run typecheck --workspace=apps/web`
  - `npm run test --workspace=apps/api -- src/application/usecases/proposal/auto-publish-proposal.usecase.test.ts`
  - `npm run test --workspace=apps/api -- src/adapters/inbound/http/skill-read.controller.test.ts src/adapters/inbound/http/error-response.test.ts src/application/usecases/proposal/submit-proposal.usecase.test.ts src/application/usecases/proposal/proposal-read.usecase.test.ts src/application/usecases/proposal/review-proposal.usecase.test.ts`
  - `npm run build:prod --workspace=packages/openapi`
  - `./scripts/check.sh`

## 2026-07-09: Proposal Package Dependency Guardrails

- `GET /howToPropose` now contains explicit package-handling guidance for
  proposal uploads: upload source artifacts and setup manifests/lockfiles, but
  exclude initialized dependency trees such as `node_modules/`, `.venv/`,
  `venv/`, `vendor/`, `dist-packages/`, and `site-packages/`.
- The proposal workflow steps and upload guardrails now tell local agents to
  strip installed dependency folders only in a temporary upload package and to
  explain the exclusions to the submitter.
- The public HowToPropose page now renders the dependency/package handling
  rules so humans can inspect the same contract that local agents consume.

## 2026-07-08: Search Version Details And Judgement Purpose Summaries

- Documented a future stateless proposal preflight endpoint that can check
  deterministic file extraction payloads before proposal submission without
  agent-side inference or workflow-state persistence.
- Public search still returns one row per skill, but each result can now expand
  a public-version details area.
- Search now falls back to fuzzy token matching when SQLite FTS returns no
  direct match, so typo-like queries such as `vido` can find `video`.
- `/search` without query or category now lists all published skills instead of
  an empty result set, and search results are paginated with 20 items per page.
- The expanded search result lists only published versions, marks the latest
  published version as active, and loads the selected version's latest overall
  judgement with risk/dimension badges.
- Judgements now include an optional `skillPurposeSummary` so UIs can show what
  the skill does without parsing free-form risk summaries.
- Publishing records previous/new published versions and stores a publish
  change note generated through the configured judger when available.
- German UI labels for navigation and admin actions now translate publish,
  drafts, review, open proposals, and how-to-propose affordances while leaving
  agent-facing API guidance and skill content untouched.
- Language changes are persisted to `localStorage` immediately when the user
  changes the language, and stored preferences continue to win over browser
  language on startup unless an explicit `?lang=` is present.

## 2026-07-08: Proposal List Judgement Overview And Local Time Format

- Admin proposal summaries now expose and render the latest proposal-level
  judgement with overview and dimension badges.
- Web timestamps now use a consistent local `YYYY-DD-MM-HH-mm-ss` display
  instead of locale-specific AM/PM formatting.
- Skill proposal comparison diffs now have a tested reference-to-current
  direction so lines removed from a proposal are shown as removals.

## 2026-07-08: Proposal Artifact Context In Skill Admin View

- Read-only skill admin views opened from a proposal now use proposal files as
  the artifact source.
- Skill-version judgements shown in that context are labeled as reference
  version judgements so they are not confused with proposal/file judgements.
- Proposal-context downloads and extracted-content reads now target proposal
  files instead of the selected skill version.
- Open proposals select the existing reference version by default instead of a
  colliding future `nextVersion` from another proposal conversion.
- In read-only proposal context, the proposal judgement panel is shown above
  artifacts while reference-version status, lifecycle, and judgement controls
  are moved below artifacts.

## 2026-07-08: Judgement Quality-Fit Dimension

- Added `qualityFit` to the shared judger contract so off-topic,
  unprofessional, placeholder-like, contradictory, or otherwise misaligned
  skill content is flagged even when safety dimensions remain low.
- custom judger, Vercel AI SDK, and noop judgers now share the same
  safety-plus-quality-fit output contract.
- Admin judgement cards now show visible findings with reasons for every
  non-low dimension instead of hiding rationale only in badge tooltips.

## 2026-07-08: Proposal Detail Review Layout

- Proposal detail is now read-only inspection only; the inline proposal
  judgement action was removed from that page.
- Proposal and file judgements are sorted newest-first and older judgements are
  collapsed behind history details.
- Conversion context moved into a sticky right-side panel, and lifecycle now
  sits below proposal judgements.

## 2026-07-08: Proposal Conversion Shortcut Version Selection

- Admin proposal conversion now returns admin skill detail with draft/rejected
  versions, not the public published-only skill detail.
- Finalize-and-review/publish shortcuts select the proposal-created draft
  version instead of falling back to the latest published reference version.

## 2026-07-08: Public Skill Judgement Visibility

- Public skill detail can now load read-only AI judgements for published skill
  versions and published version files.
- Added a reusable web `JudgementPanel` with newest-first display and
  collapsible judgement history.
- Public skill detail now shows capabilities explicitly and exposes judgement
  panels on the skill level and in the artifact explorer.
- Skill-version re-judgement now also creates per-file judgements so published
  artifact explorers can show concrete file-level AI assessments.

## 2026-07-08: Proposal Finalization Shortcuts

- Added proposal finalization shortcuts in the proposal-originated skill view:
  finalize only, finalize and send to review, and finalize and publish.
- Shortcuts call the existing workflow actions sequentially so audit entries,
  lifecycle timestamps, review status, publishing, and search indexing stay
  consistent.

## 2026-07-08: Draft And Review Queue Filters

- Added status filters to the admin draft and review queue pages.
- Review queue now defaults to active review work and keeps rejected skill
  versions behind an explicit filter.
- Added filter-specific empty states for proposal, draft, and review lists.

## 2026-07-08: Proposal List Filters And Timing

- Admin proposal lists now default to open proposals and expose rejected,
  converted, and all proposals through explicit filters.
- Proposal summaries include submission and rejection timestamps, including the
  rejecting actor when available from audit.

## 2026-07-08: Judgement Model And Lifecycle Visibility

- Proposal detail responses now include a chronological lifecycle list derived
  from proposal creation time and audit entries.
- Admin proposal and skill detail views show concrete lifecycle timestamps for
  proposal events and selected skill versions.
- Proposal-originated skill views select the newly created draft version after
  finalizing a proposal so `Submit Review` is available immediately.
- Clarified the proposal judgement button as an AI judge rerun, not a workflow
  state transition.

## 2026-07-08: Proposal Context Judgement Actions

- Restored the skill `Re-Judge` action in proposal-originated skill views while
  keeping skill review status transitions blocked until proposal finalization.
- Added a proposal re-judge action to the proposal judge panel so admins can
  refresh the proposal judgement without leaving the skill comparison context.

## 2026-07-08: Proposal Duplicate Confirmation Contract

- Hardened `GET /howToPropose` so agents must stop on exact duplicates, skill
  ID collisions, and strong intent matches before proposal upload.
- Agents now have to present the duplicate candidate, core overlap, intended
  resolution, and concise metadata/file-fingerprint diff before asking the user
  for explicit confirmation.

## 2026-07-08: EPIC-004 Judger Provider Expansion (In Progress)

- Made `JUDGER_PROVIDER` parsing explicit and fail-fast (`auto` removed).
- Added `vercel-ai-sdk` configuration fields to `AppConfig`:
  - `VERCEL_AI_SDK_MODEL`
  - `VERCEL_AI_SDK_TIMEOUT_MS`
  - `VERCEL_AI_SDK_MAX_TEXT_CHARS`
  - `VERCEL_AI_SDK_MAX_RETRIES`
- Added Vercel AI SDK model registry and adapter scaffolding for OpenAI models.
- Added tests for new config parsing and Vercel model resolution.

## 2026-07-08: Provider-Neutral Judgement Contract

- Extracted shared judgement prompt, text truncation, output parsing, dimension
  validation, score normalization, and domain `Judgement` creation from the
  custom judger adapter.
- custom judger now owns only provider transport concerns:
  - route selection,
  - authentication,
  - request execution,
  - custom judger event extraction.
- Added contract tests so future judger providers can reuse the same prompt and
  output behavior without duplicating review semantics.
- Verification:
  - `npm run typecheck --workspace=apps/api`
  - `npm run lint --workspace=apps/api`
  - `npm run test --workspace=apps/api -- src/adapters/outbound/judger/judgement-contract.test.ts src/adapters/outbound/judger/custom-judger.judger.test.ts`
  - `./scripts/check.sh`

## 2026-07-08: Review-Stage Skill Rejection

- Added `rejected` as a skill-version status for review-stage versions.
- Draft, in-review, and approved skill versions can now be rejected with a
  required reason.
- Rejection is modeled in the domain, application use case, admin HTTP API,
  OpenAPI contract, SQLite catalog projection, and admin workbench UI.
- Rejected versions remain visible in the admin review queue so they do not
  disappear after the decision.
- Published versions continue to use `deprecate` with a reason instead of
  `reject`, because published versions may already be served on the public read
  path.
- Verification:
  - `npm run typecheck --workspace=apps/api`
  - `npm run typecheck --workspace=apps/web`
  - `npm run lint --workspace=apps/api`
  - `npm run lint --workspace=apps/web`
  - `npm run test --workspace=apps/api -- src/domain/skill/SkillVersion.test.ts src/application/usecases/skill/review-skill.usecase.test.ts`
  - `npm run test --workspace=apps/web -- src/pages/ProposalDetailPage.test.ts src/i18n/LanguageProvider.test.ts src/api/client.test.ts`
  - `./scripts/check.sh`

## 2026-07-08: EPIC-003 Closure And Proposal Detail Fix

- Completed the remaining EPIC-003 cleanup:
  - translated the remaining co-located script spec,
  - converted system-facing script output to English,
  - replaced the root reusable project guide with an English version,
  - moved remaining visible frontend labels into the i18n catalog.
- Ran the EPIC-003 German-text search checklist:
  - no remaining German matches outside the German UI catalog and existing
    content/user artifacts under `data/`,
  - existing skill and proposal content remains untranslated by design.
- Fixed proposal detail error rendering:
  - load errors are shown before the loading fallback,
  - unauthorized or missing proposal detail responses no longer appear as an
    endless loading state.
- Restored proposal detail review actions:
  - admins can trigger proposal judgement from the proposal detail page,
  - proposal detail remains read-only for proposal lifecycle state and does not
    accept, reject, or convert proposals.
- Added a dedicated admin Drafts entrypoint next to open proposals:
  - `/admin/drafts` lists draft skill versions,
  - draft rows link directly into the skill review workbench.
- Added a dedicated admin Review queue:
  - `/admin/review` lists `in_review` and `approved` skill versions,
  - review rows link directly into the skill review/publish workbench.
- Verified the current open proposal detail path:
  - admin proposal list returns `prop-1783423574949-2b4turmim`,
  - admin proposal detail returns `200` with a valid admin session.
- Verification:
  - `npm run typecheck --workspace=apps/web`
  - `npm run test --workspace=apps/web -- src/i18n/LanguageProvider.test.ts src/api/client.test.ts src/pages/ProposalDetailPage.test.ts`
  - `npm run lint --workspace=apps/web`
  - `npm run typecheck --workspace=apps/api`
  - `npm run test --workspace=apps/api -- src/application/usecases/proposal/proposal-read.usecase.test.ts src/adapters/inbound/http/judgement.controller.test.ts`
  - `./scripts/check.sh`

## 2026-07-07: EPIC-003 English-First Localization

- Added `EPIC-003: English-First Localization And Agent-Facing Contracts`.
- Rewrote `AGENTS.md` and `README.md` in English.
- Added English-first repository policy:
  - canonical docs/specs/OpenAPI/API guidance are English,
  - UI defaults to English and can switch to German,
  - agents answer users in the user's current language unless asked otherwise.
- Updated `/discover` and `/howToPropose` to expose English-only agent-facing
  guidance with:
  - conversation-language rule for agents,
  - English metadata recommendation for new proposals,
  - explicit allowance for uploaded content files in any language.
- Updated OpenAPI and `SkillReadController` tests for the new fields.
- Added frontend i18n foundation with:
  - English default,
  - German toggle,
  - URL/localStorage/browser/fallback resolution,
  - message catalogs,
  - localized known API error-code presentation.
- Migrated visible frontend copy into i18n catalogs across public and admin
  pages.
- Translated core documentation:
  - `docs/index.md`
  - `docs/product/AGENT_BOOTSTRAP.md`
  - architecture docs
  - ADRs
  - setup docs
  - product design briefs
  - roadmap files
  - progress docs
- Existing skill content and metadata under `data/skills/` remain untouched by
  design.
- Verification run during the migration:
  - `npm run typecheck --workspace=apps/web`
  - `npm run test --workspace=apps/web`
  - `npm run typecheck --workspace=apps/api`
  - `npm run test --workspace=apps/api -- src/adapters/inbound/http/skill-read.controller.test.ts`
  - `npm run build:prod --workspace=packages/openapi`
  - `./scripts/check.sh`

## 2026-07-07: Proposal Contract Consolidation

- Public proposal submit screen was removed from the frontend.
- Public UI now points users to the agent-facing flow through `/discover` and
  `/howToPropose`.
- `GET /howToPropose` became the canonical proposal-preflight contract.
- The local agent must inspect packages, normalize only when needed, ensure
  `SKILL.md` as final root entrypoint, check self-contained references, check
  obvious secrets/PII, run duplicate precheck, and submit deterministically.

## 2026-07-07: Admin Proposal Workflow And Read-Only Skill Review

- Proposal detail no longer finalizes conversion immediately.
- Conversion/finalization happens in the skill detail context opened from the
  proposal.
- Proposal-originated skill views start read-only and can be explicitly switched
  into edit mode.
- File mutations are hidden in read-only proposal context.
- Judgement information was consolidated into the relevant proposal/skill views.

## 2026-07-07: Admin Login Stability

- Session cookie scope was fixed so frontend session checks and API admin routes
  receive the same cookie.
- `SimpleAdminAuth` sets the cookie on `/` and clears older scoped cookies.
- Frontend login verifies `POST /admin/login` with `GET /admin/session`.

## 2026-07-06: Search Query Sanitization

- Keyword search now handles special characters robustly and avoids FTS parser
  errors for inputs such as `Service`.

## 2026-07-03: EPIC-002 Completion

- Agent workbench UI and registry hardening reached functional completion.
- Registry bootstrap skill/reference was added.
- ADR-013 documented SQLite metadata truth.
- Public/admin visibility boundaries for proposals and judgements were hardened.
- Observability baseline and export were added.

## 2026-07-01: MVP Setup And Build Stabilization

- Initial monorepo, API, frontend, OpenAPI, domain, ports, storage/search
  adapters, tests, and deployment scripts were created.
- Build chain was stabilized with lint, typecheck, tests, production build, and
  `./scripts/check.sh`.
