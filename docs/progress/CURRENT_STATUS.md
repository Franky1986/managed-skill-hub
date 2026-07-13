# CURRENT_STATUS

## Current Date

2026-07-13

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
a stronger identity provider beyond the static bearer/admin-login baseline.

## EPIC-009 Database-Backed Content Storage

EPIC-009 is implemented for the first relational storage stage. `CONTENT_STORAGE_PROVIDER` is parsed and wired; filesystem remains the default. Database-backed content storage works for SQLite and MySQL provider modes for skill files, proposal files, extracts, aggregate state, and audit entries. `scripts/check-content-storage-matrix.ts` proves runtime parity for SQLite in `./scripts/check.sh`; `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` extends runtime parity to MySQL. `scripts/migrate-content-to-database.ts` and `scripts/export-content-filesystem.ts` provide copy-only two-way lifecycle operations with deterministic proof coverage for skills, proposals, files, extracts, scoped audits, global audits, and source preservation. Backup/restore docs and scripts distinguish filesystem, SQLite database-content, and MySQL database-content modes; MySQL database-content `DATA_DIR`-only backups fail fast.

## EPIC-007 Configurable Agent API Authentication

EPIC-007 static bearer phase is implemented:

- Agent/public auth is separate from admin session auth.
- `PUBLIC_READ_AUTH_MODE`, `PROPOSAL_AUTH_MODE`, and `DISCOVERY_AUTH_MODE` support `none` and `bearer`.
- Public read endpoints remain open by default and can be protected with a read bearer token.
- Proposal duplicate check, submit, upload, finalize, notice, and status routes remain open by default and can be protected with one proposal bearer token.
- Proposal status intentionally follows `PROPOSAL_AUTH_MODE`; there is no separate status token.
- Discovery/contract endpoints can be protected with a discovery bearer token.
- `/discover` exposes non-secret registry identity, canonical API base URL, auth flags, auth schemes, and a setup-script URL when agent auth is enabled.
- `/agent-credentials/setup.sh` generates a no-secret local setup script that stores user credentials per registry alias/base URL outside agent conversation.
- Proposal bearer auth uses the configured bearer actor as authoritative proposal actor instead of trusting `X-Actor`.

Runtime auth expansion remains open for multi-token stores, API gateways,
OAuth/OIDC, and richer per-consumer identity.

The Authentik/OIDC target is now specified in ADR-015, with separate complete
environment profiles and operator/agent playbooks. The accepted target keeps
auth modes independent, allows all active interactive Authentik users to submit
and read proposal status by known UUID by default, uses Device Authorization
for human-delegated agent work, and supports `managedskillhub-*` groups plus
stable subject UUIDs for privileged access. This is documentation and target
architecture only; runtime OIDC support has not been implemented yet.
EPIC-011 now defines the implementation sequence, provider-neutral identity and
session boundaries, additive proposal/audit migration, protocol and role test
matrix, staged rollout, rollback, and production acceptance gate.

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

- `./scripts/check.sh` with 72 co-located specs and all deterministic proof
  scripts.
- `npm run build:prod` across API, web, OpenAPI, and shared workspaces.
- `npm audit --audit-level=moderate` -> zero vulnerabilities.
- `npm audit --audit-level=moderate --package-lock-only` -> zero
  vulnerabilities.
- `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` -> baseline,
  backup/restore, MySQL stack, provider matrix, provider cutover, and database
  content-storage matrix all pass.
- Proposal lifecycle proof -> 18/18 steps pass, including submitter ownership,
  admin cleanup of an abandoned upload, and converted-state delete protection.

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
