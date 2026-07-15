# EPIC-008: Deterministic Validation And Release Proofing

## Status

Implemented - deterministic proof infrastructure in place

## Objective

Add deterministic, script-driven validation for the operational and agent-facing
contracts that are too broad or too deployment-sensitive to trust to isolated
unit tests alone.

The goal is to let a coding agent or maintainer run one command and get stable,
reviewable evidence that key runtime permutations work as expected. Every proof
script should write human-readable logs and machine-readable JSON artifacts under
`.tmp/`.

## Why This Epic Exists

ManagedSkillHub is increasingly configurable:

- SQLite or MySQL can back catalog and search projections.
- Judgement can be disabled, driven by the Vercel AI SDK, or provided by a custom
  adapter.
- Auto-publish depends on judgement state and explicit safety flags.
- Agent API authentication can be open or bearer-protected per route group.
- Agents consume published skills through API contracts and downloadable
  artifacts rather than through repository access.

Unit tests are necessary, but they do not provide enough operator confidence for
cross-cutting runtime permutations. Deterministic proof scripts close that gap by
exercising configured flows end-to-end in controlled local environments and
leaving auditable artifacts.

## Non-Goals

- Replacing unit tests or co-located `*.spec.md` files.
- Running real paid LLM calls by default.
- Requiring Docker/MySQL for the default lightweight `./scripts/check.sh` path.
- Validating arbitrary third-party custom judger implementations.
- Proving production infrastructure outside the repository's controlled local
  fixtures.

## Existing Baseline

The first deterministic proof exists for EPIC-007:

- Script: `scripts/check-agent-auth-matrix.ts`
- Spec: `scripts/check-agent-auth-matrix.spec.md`
- Artifacts: `.tmp/agent-auth-matrix.log`, `.tmp/agent-auth-matrix.json`
- Covered by: `./scripts/check.sh`

It validates all eight `PUBLIC_READ_AUTH_MODE`, `PROPOSAL_AUTH_MODE`, and
`DISCOVERY_AUTH_MODE` `none`/`bearer` permutations.

## Validation Script Standards

Every new proof script should follow these rules:

- Use deterministic fixtures and stable IDs where possible.
- Avoid real secrets and external paid services by default.
- Prefer in-memory HTTP injection for pure contract checks.
- Use isolated temporary `DATA_DIR` values for filesystem-backed workflows.
- Use Docker Compose only for provider checks that require real infrastructure,
  such as MySQL.
- Write `.tmp/<name>.log` with compact stable lines suitable for agent review.
- Write `.tmp/<name>.json` with structured details for machine inspection.
- Exit non-zero on any mismatch.
- Have a co-located `scripts/<name>.spec.md` documenting scope and outputs.
- Be linked from `docs/setup/TESTING.md` and `docs/index.md`.

## Fixture Strategy

Proof scripts should create their own isolated deterministic fixtures instead of
assuming that repository sample skills or a developer's local data already exist.

Required fixture rules:

- Use a fresh temporary `DATA_DIR` unless a script explicitly validates backup,
  restore, or deployment data handling.
- Use stable fixture IDs, titles, versions, tags, and file paths.
- Never mutate committed `data/skills/` fixtures as part of a proof run.
- Never require real tokens, real user secrets, or real paid LLM calls by default.
- Prefer fake deterministic judgers for matrix behavior and reserve real provider
  checks for explicitly opt-in scripts.
- Clean up process state created by the script; keep only `.tmp/*.log` and
  `.tmp/*.json` evidence artifacts.

## Implemented Proofs

The lightweight baseline currently includes:

- `scripts/check-agent-auth-matrix.ts`: static bearer auth permutation proof.
- `scripts/check-judger-autopublish-matrix.ts`: judger and auto-publish safety matrix proof.
- `scripts/check-agent-contract.ts`: discovery/how-to/setup-script consistency proof.
- `scripts/check-admin-ui-smoke.ts`: lightweight admin/public UI source-contract smoke proof.
- `scripts/check-openapi-parity.ts`: implemented agent-facing route vs. OpenAPI proof.
- `scripts/check-provider-matrix.ts`: provider matrix proof; SQLite subset runs in the lightweight check and MySQL combinations run through the optional full-check MySQL gate.
- `scripts/check-provider-cutover.ts`: SQLite-to-MySQL cutover proof with post-cutover write validation.
- `scripts/check-skill-package-downloads.ts`: published skill package download proof.
- `scripts/check-proposal-lifecycle.ts`: proposal upload, finalization, status, admin conversion, and draft visibility proof.
- `scripts/check-observability-audit.ts`: observability exports and file-backed audit proof.
- `scripts/check-backup-restore.ts`: backup and restore script proof with isolated data.
- `scripts/check-concurrency-abuse.ts`: proposal state guard and unsafe package path proof.
- `scripts/check-public-release-hygiene.sh`: public release hygiene proof.
- `scripts/full-check.sh`: extended-check entrypoint with optional smoke and MySQL gates.

## Proof Script Details And Backlog

### 1. Provider Matrix Proof

Implemented script:

`scripts/check-provider-matrix.ts`

Purpose:

Validate provider parity for catalog and search combinations.

Matrix:

| Catalog provider | Search provider | Required infrastructure |
|---|---|---|
| sqlite | sqlite | none |
| mysql | mysql | local MySQL stack |
| sqlite | mysql | local MySQL stack |
| mysql | sqlite | local MySQL stack |

Required checks:

- Create deterministic fixture skills and published versions.
- Rebuild projections with `clearProjections=true`.
- Verify `/discover`, `/skills`, `/skills/search`, `/categories`, and
  `/tags` parity.
- Verify exact version resolution for skill files and package downloads.
- Verify MySQL startup guidance does not require manual pre-start when the local
  MySQL stack is configured.

Artifacts:

- `.tmp/provider-matrix.log`
- `.tmp/provider-matrix.json`

Default execution:

- `./scripts/check.sh` runs the infrastructure-free `sqlite/sqlite` subset.
- `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` starts the local MySQL stack and runs the full `sqlite/sqlite`, `mysql/mysql`, `sqlite/mysql`, and `mysql/sqlite` matrix.
- Every non-baseline provider case is normalized and compared against the `sqlite/sqlite` public endpoint snapshot.

### 2. Judger And Auto-Publish Matrix Proof

Proposed script:

`scripts/check-judger-autopublish-matrix.ts`

Purpose:

Validate that judgement availability and auto-publish safety flags produce the
expected proposal state transitions.

Matrix:

| Judger provider | Auto publish | Auto approve without judger | Expected behavior |
|---|---|---|---|
| noop | false | false | proposal remains submitted/not judged |
| noop | true | false | no auto-publish; explicit not-judged state |
| noop | true | true | auto-approval allowed only because flag is explicit |
| deterministic green fake | true | false | proposal auto-publishes when all checks are green |
| deterministic risky fake | true | false | proposal remains in review |
| throwing fake | true | false | proposal persists and records unavailable judgement |

Required checks:

- `noop` must never create realistic low-risk judgements.
- No auto-publish happens without judgement unless
  `AUTO_APPROVE_WITHOUT_JUDGER=true`.
- Frontend/API judgement state is distinguishable as not judged or unavailable.
- Audit entries explain why auto-publish did or did not happen.

Artifacts:

- `.tmp/judger-autopublish-matrix.log`
- `.tmp/judger-autopublish-matrix.json`

### 3. Proposal Lifecycle Proof

Proposed script:

`scripts/check-proposal-lifecycle.ts`

Purpose:

Validate the complete agent-submitted proposal workflow from preflight to admin
resolution.

Required checks:

- `GET /howToPropose` exposes current package rules.
- Duplicate precheck returns deterministic exact/similar candidates.
- Proposal creation starts in `in_upload`.
- File upload preserves relative paths.
- Blocked dependency-tree paths are rejected.
- Missing or broken local references block finalization.
- Finalization creates proposal/file judgements according to current judger
  configuration.
- Admin can create a draft from a new proposal.
- Admin can publish, reject, or delete according to allowed proposal state.
- Public read path only exposes published skills.

Artifacts:

- `.tmp/proposal-lifecycle.log`
- `.tmp/proposal-lifecycle.json`

### 4. Skill Download And Package Proof

Proposed script:

`scripts/check-skill-package-downloads.ts`

Purpose:

Validate that agents can deterministically consume published skill versions
without reconstructing files from chat output.

Required checks:

- For a single-file published version, download can return the `SKILL.md`
  directly when that is the configured response contract.
- For multi-file published versions, download returns a ZIP package.
- Package paths are relative and safe.
- Package content matches the published version digest/metadata.
- Explicit version download returns that version, not latest.
- Latest download resolves to latest published version only.
- Draft, rejected, or unpublished versions are not publicly downloadable.
- The package contains enough data for a local agent to run a post-download
  consistency check.

Artifacts:

- `.tmp/skill-package-downloads.log`
- `.tmp/skill-package-downloads.json`

### 5. Agent Contract Proof

Proposed script:

`scripts/check-agent-contract.ts`

Purpose:

Validate consistency between `/discover`, `/howToPropose`, OpenAPI, setup
scripts, and agent bootstrap documentation.

Required checks:

- `/discover` links all relevant public/proposal/download entrypoints.
- `/howToPropose` reflects current auth, upload, duplicate, and package rules.
- Auth setup instructions appear only when an auth-protected action exists.
- OpenAPI documents every agent-facing route and configured auth response.
- Agent bootstrap docs reference the same workflow and do not instruct agents to
  paste secrets into chat.

Artifacts:

- `.tmp/agent-contract.log`
- `.tmp/agent-contract.json`

### 6. Public Release Hygiene Proof

Proposed script:

`scripts/check-public-release-hygiene.sh`

Purpose:

Catch accidental publication of private files, tokens, absolute local paths,
or outdated public docs.

Required checks:

- No tracked `.env` files except approved examples.
- No obvious bearer tokens, API keys, OpenAI keys, or private service tokens.
- No public docs advertise private adapters as default setup.
- No tracked private custom adapter implementation files.
- No absolute local user paths in public docs except explicitly allowed examples.
- Git history scan command is documented and can be run before public release.
- Public README, README_de, LICENSE, SECURITY, CONTRIBUTING, and NOTICE exist.

Artifacts:

- `.tmp/public-release-hygiene.log`
- `.tmp/public-release-hygiene.json`

### 7. Backup And Restore Proof

Proposed script:

`scripts/check-backup-restore.ts`

Purpose:

Validate that a deployment can be backed up and restored without losing skill,
proposal, audit, and projection consistency.

Required checks:

- Create deterministic skills, proposals, judgements, audit entries, and public
  projections in an isolated `DATA_DIR`.
- Run `scripts/backup.sh`.
- Restore into a fresh isolated `DATA_DIR`.
- Verify API parity after restore.
- Verify projections can be rebuilt after restore.
- Verify backup scripts never delete existing deployment data.

Artifacts:

- `.tmp/backup-restore.log`
- `.tmp/backup-restore.json`

### 8. OpenAPI Implementation Parity Proof

Proposed script:

`scripts/check-openapi-parity.ts`

Purpose:

Validate that the OpenAPI contract remains aligned with implemented
agent-facing HTTP behavior.

Required checks:

- Every documented public/proposal route is implemented.
- Every implemented public/proposal route has an OpenAPI operation.
- Auth-protected routes document `401` responses.
- Download routes document actual content types and status codes.
- Key response fields used by agents are present in schemas.

Artifacts:

- `.tmp/openapi-parity.log`
- `.tmp/openapi-parity.json`

### 9. Admin UI Proof

Proposed script:

`scripts/check-admin-ui-smoke.ts`

Purpose:

Validate that the browser-facing UI remains consistent with the API contracts and
current runtime configuration.

Required checks:

- Public Explore/Search pages load without admin login when public read is open.
- Public pages show auth/setup guidance only when the current config requires it.
- Admin login succeeds with configured credentials and logout clears the session.
- Admin-only navigation entries are hidden for anonymous users.
- Proposal detail shows not-judged/unavailable judgement states distinctly.
- Admin can open a proposal, create a draft, and reach the expected review views.
- UI copy for agent-session and OIDC guidance matches the API's config-aware response.

Artifacts:

- `.tmp/admin-ui-smoke.log`
- `.tmp/admin-ui-smoke.json`
- Optional screenshots under `.tmp/admin-ui-smoke/` when a failure occurs.

### 10. Observability And Audit Proof

Proposed script:

`scripts/check-observability-audit.ts`

Purpose:

Validate that important state transitions leave enough audit and observability
evidence for operators to understand what happened.

Required checks:

- Proposal creation, file upload, finalization, judgement, rejection, conversion,
  and publish actions create audit entries.
- Auto-publish allowed, auto-publish blocked, and not-judged cases are visible in
  audit or observability output.
- Auth failures on agent-facing protected routes are counted/classified without
  leaking tokens.
- Projection rebuild emits a traceable administrative event.
- CSV and JSON observability exports include the same deterministic fixture
  events.

Artifacts:

- `.tmp/observability-audit.log`
- `.tmp/observability-audit.json`

### 11. Migration And Cutover Proof

Implemented script:

`scripts/check-provider-cutover.ts`

Purpose:

Validate the real operator workflow for moving from SQLite-local operation to a
MySQL-backed deployment.

Required checks:

- Start with SQLite catalog/search and create deterministic skills/proposals.
- Capture public API baseline responses.
- Start the local MySQL stack when needed.
- Switch to MySQL catalog/search providers.
- Run projection rebuild with `clearProjections=true`.
- Verify public API parity after cutover.
- Verify new writes after cutover are visible through MySQL providers.
- Verify restart scripts handle MySQL startup/preflight without requiring manual
  separate stack startup.
- Verify MySQL-to-SQLite rollback preserves the post-cutover public API surface.

Artifacts:

- `.tmp/provider-cutover.log`
- `.tmp/provider-cutover.json`

Execution:

- Runs only in `./scripts/full-check.sh` or explicit local invocation because it
  requires MySQL/Docker.

### 12. Concurrency And Abuse Proof

Proposed script:

`scripts/check-concurrency-abuse.ts`

Purpose:

Validate that repeated, concurrent, or malformed operations fail safely and do
not corrupt proposal, skill, package, or projection state.

Required checks:

- Finalizing the same proposal twice is either idempotent or returns a clear
  domain error without changing the already-finalized state.
- Publishing or converting the same proposal twice cannot create duplicate
  published versions.
- Duplicate file uploads resolve predictably and preserve the intended latest
  package state.
- Blocked paths, path traversal attempts, zip-slip style paths, and invalid
  relative paths are rejected.
- Upload file count and file size limits are enforced at the HTTP boundary.
- Concurrent projection rebuild requests do not leave partial projections.
- Downloaded packages never contain unsafe absolute paths or parent-directory
  traversal.

Artifacts:

- `.tmp/concurrency-abuse.log`
- `.tmp/concurrency-abuse.json`

## Execution Model

Use two levels of validation:

1. `./scripts/check.sh`: lightweight mandatory checks that do not require
   Docker, external services, or real secrets.
2. `./scripts/full-check.sh`: extended operational checks, including MySQL,
   backup/restore, and any provider matrix requiring local containers.

Initial recommended split:

| Script | check.sh | full-check.sh |
|---|---|---|
| check-agent-auth-matrix.ts | yes | yes |
| check-agent-contract.ts | yes | yes |
| check-openapi-parity.ts | yes | yes |
| check-public-release-hygiene.sh | yes | yes |
| check-judger-autopublish-matrix.ts | yes | yes |
| check-proposal-lifecycle.ts | yes | yes |
| check-skill-package-downloads.ts | yes | yes |
| check-provider-matrix.ts | sqlite-only subset | full matrix |
| check-backup-restore.ts | executable checked | yes |
| check-admin-ui-smoke.ts | yes, source-contract | yes |
| check-observability-audit.ts | yes | yes |
| check-provider-cutover.ts | executable checked | yes |
| check-concurrency-abuse.ts | yes | yes |

## Follow-Up Options

1. Optional Browser E2E Upgrade: replace or supplement the current source-contract admin UI proof with browser automation if the project later adopts a browser test dependency.
2. Smoke Gate Policy Review: `RUN_SMOKE_TEST=true` remains opt-in for local/server checks; revisit if production deployment automation needs it as a required gate.

## CI And Release Gates

Target execution policy:

| Context | Required checks |
|---|---|
| Local quick validation | `./scripts/check.sh` |
| Pull request CI | `./scripts/check.sh` via `.github/workflows/validation.yml` plus uploaded lightweight proof artifacts |
| Nightly or release-candidate CI | `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` via the scheduled/manual MySQL full validation job |
| Public release gate | Full check artifacts plus public-release hygiene and separate git-history scan evidence |

Release readiness must be based on generated artifacts, not only terminal output.
A release candidate should preserve the latest relevant `.tmp/*.log` and
`.tmp/*.json` files in CI artifacts.

## Definition Of Done

- Each proof script has a co-located `*.spec.md`.
- Each proof script writes stable `.tmp/*.log` and `.tmp/*.json` artifacts.
- Each proof script uses isolated deterministic fixtures and avoids mutating committed sample data.
- `docs/setup/TESTING.md` documents when and how to run each script.
- `docs/index.md` links the scripts and specs.
- `docs/progress/CURRENT_STATUS.md`, `NEXT_STEPS.md`, and
  `CHANGELOG_INTERNAL.md` are updated as scripts are implemented.
- `./scripts/check.sh` remains green.
- `./scripts/full-check.sh` is green in an environment with Docker and MySQL
  available.
- CI/release documentation states which proof artifacts must be kept for release evidence.
