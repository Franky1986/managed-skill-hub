# CURRENT_STATUS

## Current Date

2026-07-14

## Project State

`managed-skill-hub` is a self-hosted, agent-facing skill registry. It exposes
published skills through public read endpoints, provides a protected admin
workbench for skill/proposal review, and stores managed content through configurable filesystem or database-backed adapters with relational metadata/search projections for read paths.

## Security Hardening Baseline

The current public-release hardening baseline includes restrictive configured
CORS origins, admin mutation Origin/Referer validation, production fail-fast for
default admin session secrets/plaintext passwords, artifact response hardening
with `nosniff` plus sandbox CSP, attachment delivery for active browser content
types, public file-read manifest validation, filesystem-storage path containment,
and restore archive member validation. Proposal writes have production fail-fast
auth defaults, per-process rate limits, and submitter ownership checks. The
locked dependency graph currently audits with zero known vulnerabilities.
Remaining production concerns include gateway-level distributed rate limits and
completion of the environment-specific real Authentik activation gate.
Runtime configuration is layered so agent-editable `.env` profiles contain no
secret assignments; `.env.secrets` or exported deployment secrets supply keys
with higher precedence.
Authentication acceptance scenario `AUTH-00` passed locally on commit
`7d96823`: baseline checks, deterministic auth/OIDC proofs, production builds,
the moderate dependency audit, and the full configured MySQL gate passed with
zero known dependency vulnerabilities. The real Authentik staging gate remains
environment-specific and is not yet accepted.

## EPIC-009 Database-Backed Content Storage

EPIC-009 is implemented for the first relational storage stage. `CONTENT_STORAGE_PROVIDER` is parsed and wired; filesystem remains the default. Database-backed content storage works for SQLite and MySQL provider modes for skill files, proposal files, extracts, aggregate state, and audit entries. `scripts/check-content-storage-matrix.ts` proves runtime parity for SQLite in `./scripts/check.sh`; `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` extends runtime parity to MySQL. `scripts/migrate-content-to-database.ts` and `scripts/export-content-filesystem.ts` provide copy-only two-way lifecycle operations with deterministic proof coverage for skills, proposals, files, extracts, scoped audits, global audits, and source preservation. Backup/restore docs and scripts distinguish filesystem, SQLite database-content, and MySQL database-content modes; MySQL database-content `DATA_DIR`-only backups fail fast.

## EPIC-007 Configurable Agent API Authentication

EPIC-007 static bearer compatibility remains implemented:

- Agent/public auth is separate from admin session auth.
- `PUBLIC_READ_AUTH_MODE`, `PROPOSAL_AUTH_MODE`, and `DISCOVERY_AUTH_MODE` retain
  `none` and `bearer` alongside the EPIC-011 OIDC expansion.
- Public read endpoints remain open by default and can be protected with a read bearer token.
- Protected public read endpoints also accept a valid admin browser session
  with `reader` or `admin` as a read-only alternative. Discovery and proposal
  routes do not inherit this session fallback.
- Proposal duplicate check, submit, upload, finalize, notice, and status routes remain open by default and can be protected with one proposal bearer token.
- Proposal status intentionally follows `PROPOSAL_AUTH_MODE`; there is no separate status token.
- Discovery/contract endpoints can be protected with a discovery bearer token.
- `/discover` exposes non-secret registry identity, canonical API base URL, auth
  flags, and auth schemes. A setup-script URL appears only when static bearer
  auth is active.
- Agent-session delegation (`/frontend/agent-auth`) lets humans create short-lived sessions for bearer-protected areas without sharing long-lived tokens in chat.
- Proposal bearer auth uses the configured bearer actor as authoritative proposal actor instead of trusting `X-Actor`.

API-gateway and multi-token static credential stores remain optional future
extensions; verified per-human identity is now provided by EPIC-011 OIDC.

## EPIC-012 Agent Session Delegation

EPIC-012 is implemented:

- Short-lived, area-scoped agent sessions can be created through a public
  browser page at `/frontend/agent-auth`.
- The human enters bearer tokens for the enabled areas (`discovery`,
  `public-read`, `proposal`) in dedicated headers and receives an 8-character
  session code.
- The agent sends the code as `Authorization: AgentSession <code>` on protected
  routes.
- `POST /agent-sessions` requires a valid bearer token for every requested area,
  preventing one area token from delegating another.
- Session lifecycle (create, validate, list, revoke) is stored in the configured
  catalog database and can be inspected/revoked by admins at
  `/frontend/admin/agent-sessions`.
- When an admin opens `/frontend/agent-auth`, the page loads
  `/admin/agent-auth-config` and displays the configured bearer token values
  for copy/paste sharing, then creates sessions by area selection without
  retyping tokens.
- `/discover` advertises the absolute `/frontend/agent-auth` URL in the
  `agent-session` auth scheme so agents can present a clickable link to the
  user instead of only describing the path. The URL is resolved against the
  frontend origin, not the API backend port.
- OpenAPI, co-located specs, and matrix tests cover the new flow.
- The feature is toggled by `AGENT_SESSION_ENABLED` and configured through
  `AGENT_SESSION_TTL_SECONDS`, `AGENT_SESSION_CODE_LENGTH`,
  `AGENT_SESSION_CODE_CHARSET`, and `AGENT_SESSION_MAX_ACTIVE`.

## EPIC-011 Authentik OIDC And Delegated Agent Authentication

The repository runtime implementation is complete and deterministic gates pass:

- Admin auth independently selects simple login or server-side Authentik
  Authorization Code with PKCE, one-time state/nonce transactions, opaque local
  sessions, strict cookies, bounded expiry, revocation, and no SPA provider
  tokens.
- Discovery, published read, and proposal areas independently compose all 27
  `none|bearer|oidc` combinations. OIDC advertises public Device Authorization
  metadata while static credential setup remains bearer-only.
- Access tokens are verified with `openid-client` and `jose` against exact
  issuer, audience, `azp`, Authentik `uid`, asymmetric signature, time, area
  scope, human policy, token/group bounds, and trusted-origin JWKS. Token class
  is either strict RFC 9068 `at+jwt` or Authentik `JWT` plus mandatory
  authenticated active/client/subject introspection.
- Unknown signing keys trigger one bounded reload; deterministic rotation and
  provider-outage tests fail closed. The deterministic proof first validates a
  realistic OIDC ID token and its `at_hash`, then proves that the API access-token
  verifier rejects it.
- Existing Authentik humans are projected just in time without passwords.
  Proposal/audit persistence records stable principal and public client IDs;
  another accepted human may read a known UUID but cannot mutate the proposal.
  Simultaneous first logins through admin and agent issuers converge on one
  deterministic tenant/subject principal ID.
- Admin subject bootstrap and `managedskillhub-*` reviewer, publisher, and admin
  groups map to server-enforced routes and role-aware UI actions.
- SQLite/MySQL, mixed catalog/search, and filesystem/database-content proofs
  preserve identity/session/transaction fields. The full MySQL gate passes.
- Normal `./scripts/check.sh`, production build, OpenAPI parity, UI source smoke,
  and dependency audit pass without external Authentik.
- Production static bearer secrets require at least 32 bytes; protocol/session
  settings have hard upper bounds, provider bodies are stream-bounded, simple
  login has in-process throttling, and the proposal badge uses admin auth.

Production activation is intentionally still pending the target tenant's live
Device Flow, reverse-proxy callback, two-human browser/ownership, role, key
rotation/outage, session-expiry, logout, and rollback evidence. The optional
`RUN_AUTHENTIK_STAGING_CHECK=true` full-check gate validates this evidence and a
short-lived real human access/ID token pair. The gate independently validates
the ID token, requires the same subject, validates `at_hash` when present, and
otherwise requires schema-v2 same-response operator evidence.
`docs/setup/AUTHENTICATION_ACCEPTANCE_CHECKLIST.md` provides the corresponding
profile-by-profile manual run record and sanitized result handoff for follow-up
agents.
`.env.example.authentik` keeps its activation warning until that gate passes.

## EPIC-006 MySQL Support and Relational Provider Decoupling

EPIC-006 is implemented:

- Provider selection is independent and explicit via `CATALOG_PROVIDER` and
  `SEARCH_PROVIDER` (`sqlite`/`mysql`).
- MySQL catalog and search adapters are implemented, including schema runners and
  provider-specific migration/rebuild behavior.
- Search ranking is normalized to a provider-neutral higher-is-better score contract.
- Projection rebuild is available as `POST /admin/projections/rebuild` and rebuilds
  skills, proposals, judgements, audits, and search documents from source of
  truth.
- Operational configuration and cutover docs are in `docs/setup/ENVIRONMENT.md` and
  `docs/setup/TESTING.md`.
- MySQL/SQLite and MySQL/MySQL provider combinations are covered by adapter and
  rebuild/use-case tests.
- MySQL catalog `DATETIME` values are parsed as UTC and mutating proposal use
  cases load repository aggregates before catalog fallback, preventing stale
  read projections from overwriting source-of-truth proposal timestamps.
- The API workspace declares and locks the `mysql2` runtime driver, so clean
  installs can execute the MySQL provider path.
- Database-backed content transactions are request-context isolated: concurrent
  MySQL requests cannot join another request's transaction, while SQLite queues
  outside operations around its shared async transaction connection.
- Local MySQL bootstrap is documented via `.docker/mysql-stack.yml` and
  `scripts/start-mysql-stack.sh`, with `restart-all.sh` now validating local MySQL
  reachability before API startup in MySQL mode.

## EPIC-001

EPIC-001 is implemented as the MVP foundation:

- Monorepo with API, web app, OpenAPI package, and shared package.
- Fastify API and React/Vite frontend.
- File-based storage under `data/`.
- Public skill retrieval and search.
- Protected admin API and UI.
- Proposal submission and admin review.
- Judgement model and custom judger-ready judger port.
- Deployment, backup, restore, and check scripts.
- `./scripts/check.sh` passes.

## EPIC-002

EPIC-002 is functionally complete:

- Public retrieval only exposes `published` skills and published versions.
- Skill contracts include `skillUuid`, `versionUuid`, `contentDigest`, and file
  metadata such as `artifactId`, `sha256`, `updatedAt`, and `extractable`.
- `category` is required and categories can be fetched.
- Public discovery now also exposes `/tags`, and `/skills` plus
  `/skills/search` support repeated `tag` filters as an AND constraint.
- Public/admin viewers show skill files as a folder tree.
- Text files have an invisible-character toggle.
- Extractable files expose initially collapsed `Extracted Content`.
- Non-text artifacts are downloadable.
- Proposal details and judgement data are admin-only.
- Admins can inspect and trigger proposal, skill, and file judgements.
- Judger providers share a provider-neutral judgement contract for prompt
  construction, output parsing, standardized risk dimensions, and score
  normalization.
- Registry reruns such as `re-extract`, `re-judge`, and `re-index` do not
  execute skill code and do not mutate original artifacts.
- SQLite and MySQL projections are both supported for metadata reads depending on
  configured providers. In SQLite mode, this acts as the metadata truth for large
  parts of retrieval, categories, versions, proposals, judgements, and history.
  Filesystem remains the artifact storage.
- ADR-013 documents the SQLite metadata-truth decision.

## EPIC-003 English-First Localization

EPIC-003 is implemented:

- `AGENTS.md` is fully English and defines the English-first repository policy.
- `README.md`, `docs/index.md`, architecture docs, ADRs, setup docs, product
  briefs, roadmap files, co-located specs, script specs, helper scripts, and
  this progress status are English.
- `GET /discover` and `GET /howToPropose` return English-only agent-facing
  guidance.
- Agent-facing guidance tells agents to communicate with users in the language
  the user is currently using unless asked otherwise.
- Proposal guidance recommends English metadata for new proposals while allowing
  uploaded content in any language.
- Proposal guidance now also forbids uploading initialized dependency trees
  such as `node_modules/`, `.venv/`, `venv/`, `vendor/`, `dist-packages/`, and
  `site-packages/`; agents should upload source files plus setup
  manifests/lockfiles instead and leave dependency installation to the later
  consumer environment.
- Existing skill content and metadata under `data/skills/` were not translated.
- OpenAPI was updated for the English discovery/how-to-propose fields.
- Web UI has a central i18n foundation:
  - `LanguageCode = 'en' | 'de'`
  - English default
  - URL parameter, `localStorage`, browser language, English fallback
  - app-shell language toggle
  - catalog-backed public pages and admin workbench copy
  - localized frontend presentation for known API error codes
- Visible frontend copy is catalog-backed for app shell, Home, Search,
  HowToPropose, skill detail, proposal status/detail, admin login, dashboard,
  proposal pages, skill create, and skill workbench.
- Root-level reusable project guidance in `newProjectSkillWithSpecMd.md` is
  English.
- Remaining German search matches are classified as:
  - intentional German UI catalog content in `apps/web/src/i18n/messages.ts`,
  - existing content/user artifacts under `data/`, such as proposal examples.

## EPIC-004 Judgement Provider Expansion

EPIC-004 is in progress:

- `JUDGER_PROVIDER` is explicit (`noop`, `vercel-ai-sdk`, or an arbitrary custom
  provider loaded through `JUDGER_ADAPTER_PATH`).
- Shared judgement prompt/output contract remains in
  `apps/api/src/adapters/outbound/judger/judgement-contract.ts`.
- Vercel model registry and adapter files are added under
  `apps/api/src/adapters/outbound/judger/`.
- Configuration now supports `VERCEL_AI_SDK_*` options and validates
  `JUDGER_PROVIDER`.
- Provider-specific custom adapter settings are parsed by the adapter itself and
  do not leak into the provider-neutral `AppConfig`.
- JUDGE-03 is accepted against the local custom-provider custom adapter: proposal
  and file judgements persisted across restart, conversion generated skill and
  file judgements, and the normal required-policy review/approve/publish path
  completed. Failure, retry, alternate-policy, override, and independent-role
  scenarios remain pending.

## EPIC-005 Proposal Upload Finalization

EPIC-005 is implemented:

- Proposal uploads now start in `in_upload` instead of being submitted
  immediately.
- Attached proposal files are only accepted while the upload is open.
- Proposal file uploads can preserve relative in-package paths through a
  multipart `path` field instead of flattening every artifact to the root
  filename.
- Submitter agents must explicitly call
  `POST /proposals/{id}/finalize-upload` to transition into `submitted` and
  trigger proposal/file judgements.
- Runtime upload limits are centrally env-configured:
  - `PROPOSAL_MAX_FILES`
  - `PROPOSAL_MAX_FILE_SIZE_BYTES`
  - `PROPOSAL_DISALLOWED_PATHS`
- `GET /howToPropose` now exposes the effective upload limits and the required
  finalization step as machine-readable contract data, including the rule to
  preserve meaningful subfolders and keep relative references valid after
  normalization.
- Proposal validation now returns portable command guidance for
  `.cursor/commands/`, `.codex/commands/`, and `.claude/commands/` references.
  Existing `commands/` folders are preserved, missing `commands/manifest.json`
  is a non-blocking warning, and manifest source inconsistencies are reported
  without blocking finalization.
- Proposal APIs are rate-limited in-memory per authenticated proposal bearer
  actor or IP, and production startup requires `PROPOSAL_AUTH_MODE=bearer`
  unless `ALLOW_OPEN_PROPOSALS_IN_PRODUCTION=true` is explicitly configured.
- Forwarded client IPs are trusted only from `API_TRUSTED_PROXIES`; proposal
  rate-limit buckets are lazily expired and bounded per API process. All route
  aliases share one limiter, and new identities receive `429` when every bucket
  is active instead of resetting existing limits through eviction. The nginx
  deployment baseline adds shared request, connection, and upload-body limits.
- Public proposal metadata, file, validation, finalize, and delete mutations
  require the authoritative actor to match `submittedBy`. Admin review remains
  privileged and can remove abandoned `in_upload` proposals, but finalized or
  converted proposals cannot be deleted through the cleanup endpoint.
- Fastify 5, AI SDK 6/OpenAI provider 3, Vite 6.4.3, and `bcryptjs` remove the
  previously reported npm advisory groups; the lockfile audit currently reports
  zero vulnerabilities.
- `/howToPropose` now requires agents to build, recursively scan, normalize,
  and hash the final temporary upload package before `POST /proposals`; server
  `validate-upload` is documented as the final server check, not the first
  reference scanner.
- PPTX extraction uses deterministic in-process OOXML parsing and never launches
  LibreOffice. Remaining third-party document parsing is guarded by a fixed
  timeout.
- Public proposal status now distinguishes incomplete uploads through
  `status = in_upload`, `uploadFinalized`, and `finalizeRequired`.
- Public proposal status also exposes whether auto-publish is enabled, whether
  the finalized proposal was eligible, and the coarse blocker reason when
  automation was skipped or failed.
- Pending proposal notice/counting now includes `in_upload` proposals.
- Finalized proposals can now be auto-published when
  `AUTO_PUBLISH_ON_GREEN=true`, every required proposal/file judgement is fully
  green, no duplicate/manual blockers exist, and the excluded-category
  classifier does not block the proposal.
- Auto-publish decisions are audited distinctly through
  `evaluate_auto_publish`, `auto_publish_proposal`, and
  `auto_publish_failed`.
- Admin proposal list/detail views expose incomplete uploads and auto-publish
  state, including a dedicated `in_upload` filter.
- Proposal navigation count, admin proposal list/detail, and public proposal
  status refresh immediately and then every 10 seconds through a shared
  non-overlapping background poller. Existing content and local interaction
  state remain visible while replacement data loads.

## Proposal Detail Navigation

- `GET /admin/proposals` lists the current open proposal
  `prop-1783423574949-2b4turmim`.
- `GET /admin/proposals/prop-1783423574949-2b4turmim` returns `200` with a
  valid admin session.
- The frontend proposal detail page now renders load errors before the loading
  fallback, so missing or expired admin sessions no longer look like an endless
  loading state.
- Proposal detail exposes explicit review actions again:
  - admins can trigger proposal judgement from the proposal detail page,
  - proposal detail remains read-only for proposal lifecycle state and does not
    accept, reject, or convert proposals.
- Draft skills are reachable through a dedicated `/admin/drafts` route linked
  from the app shell and admin dashboard.
- Skill versions submitted for review or approved for publishing are reachable
  through `/admin/review`.
- Draft, in-review, and approved skill versions can be rejected from the skill
  workbench with a required reason.
- Rejected skill versions are persisted as `rejected`, store rejection metadata
  in the SQLite catalog projection, and stay visible in `/admin/review`.
- Published versions are not rejected; they use the existing deprecation flow
  with a reason.

## Verification

Recently verified:

- `./scripts/check.sh` with 84 co-located specs, 404 API tests in 61 files, 31
  web tests, and all deterministic proof scripts after the judgement-state and
  publication-gate changes.
- `npm run build:prod` after the judgement-state and publication-gate changes;
  only the known non-blocking Vite chunk-size warning remains.
- `npm audit --audit-level=moderate` -> zero vulnerabilities.
- `npm run build:prod` across API, web, OpenAPI, and shared workspaces.
- `npm audit --audit-level=moderate --package-lock-only` -> zero
  vulnerabilities.
- `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` -> baseline,
  backup/restore, MySQL stack, provider matrix, provider cutover, and database
  content-storage matrix all pass.
- Proposal lifecycle proof -> 18/18 steps pass, including submitter ownership,
  admin cleanup of an abandoned upload, and converted-state delete protection.

## Judgement Visibility And Publication Gate

- Proposal detail responses expose explicit judgement execution state for the
  proposal and every file: `not_started`, `completed`, `unavailable`, or
  `failed`, including provider and last attempt time without raw provider
  errors.
- Automatic finalization no longer reports judgement completion when the
  provider was unavailable, failed, or produced only noop placeholders.
- Reviewers can retry the proposal or one stored proposal file after conversion;
  retry does not reopen terminal proposal lifecycle states.
- Converted proposal views expose the created draft-version lifecycle controls
  without requiring edit mode.
- `PUBLISH_JUDGEMENT_POLICY` supports `disabled`, `warn`, and `required`.
  Production defaults to `required`; administrator override requires a
  non-empty audited reason.
- Structured judgement runtime events identify operation, provider, outcome,
  and safe error category. Built-in providers combined with a custom adapter
  path warn in development and fail startup in production.
- Public proposal status guidance follows the current lifecycle state; terminal
  proposals no longer advertise conversion or rejection as pending admin work.

## Important Operational Rules

- Do not delete `data/` during deploy.
- Do not edit or translate existing skill content or metadata as part of
  EPIC-003.
- Do not treat skill changes as filesystem-only changes; consider SQLite
  projection and search index as well.
- Public reads deliver only `published` skills.
- Agent-facing API output remains English-only; UI localization is frontend
  presentation only.

## EPIC-008 Deterministic Proof Infrastructure

Implemented lightweight deterministic proof scripts for agent auth, agent contract consistency, judger/auto-publish safety, provider matrix parity, provider cutover validation, admin UI smoke validation, skill package downloads, proposal lifecycle, concurrency/abuse safety, observability/audit evidence, OpenAPI parity, and public release hygiene. `./scripts/check.sh` now emits `.tmp/*` proof artifacts for these gates. Extended smoke/MySQL gates are available through `./scripts/full-check.sh`; MySQL remains an explicit local flag and is mandatory in pull-request CI.
