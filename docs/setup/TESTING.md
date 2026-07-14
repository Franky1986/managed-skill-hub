# Testing Guide

This guide explains how a new agent or developer can try the
`managed-skill-hub` project locally.

## Prerequisites

- Node.js >= 20 LTS
- npm >= 10
- curl for API tests
- Optional: jq for readable JSON output

## 1. Initialize The Project

```bash
cd /path/to/managed-skill-hub
npm ci --legacy-peer-deps
```

## 2. Verify Build And Checks

```bash
./scripts/check.sh
```

This runs lint, typecheck, and tests. The result must be `[OK]`.

For release parity, also run the locked dependency audit, production build, and
the Docker/MySQL gate:

```bash
npm audit --audit-level=moderate --package-lock-only
npm run build:prod
RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh
```

The API workspace declares `mysql2`; no undeclared local package is required by
the MySQL checks after a clean `npm ci`.

For configuration-profile acceptance against a real deployment, execute and
record the scenarios in
[`AUTHENTICATION_ACCEPTANCE_CHECKLIST.md`](./AUTHENTICATION_ACCEPTANCE_CHECKLIST.md).
It separates deterministic coverage from browser, multi-user, reverse-proxy,
real Authentik, and rollback evidence.

## 3. Configure Environment

### Layered Root Environment

```bash
cp .env.example .env
cp .env.secrets.example .env.secrets
chmod 600 .env .env.secrets
```

In `.env`:

```env
JUDGER_PROVIDER=noop
```

In `.env.secrets`:

```env
ADMIN_PASSWORD=admin
```

For custom judger setups, follow the provider-neutral adapter contract in
[`docs/setup/JUDGER_ADAPTERS.md`](./JUDGER_ADAPTERS.md).

Alternative with BCrypt hash, using `admin` as the example password:

```bash
node -e "console.log(require('bcryptjs').hashSync('admin', 10))"
```

Then store the hash in `.env.secrets`:

```text
ADMIN_PASSWORD_HASH='$2b$10$...'
```

Recommended: set `JWT_SECRET` to a random value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Root Environment For Vercel AI SDK Judger

When the Vercel AI SDK should be used locally:

```bash
cp .env.example .env
cp .env.secrets.example .env.secrets
```

Set the provider/model in `.env`:

```env
JUDGER_PROVIDER=vercel-ai-sdk
VERCEL_AI_SDK_MODEL=openai:gpt-4.1
```

Set the API key in `.env.secrets`:

```env
OPENAI_API_KEY=sk-...
```

Optional overrides:

```bash
VERCEL_AI_SDK_TIMEOUT_MS=30000
VERCEL_AI_SDK_MAX_TEXT_CHARS=12000
VERCEL_AI_SDK_MAX_RETRIES=0
```

Optional proposal-upload/runtime overrides in the same root `.env`:

```bash
PROPOSAL_MAX_FILES=30
PROPOSAL_MAX_FILE_SIZE_BYTES=10485760
PROPOSAL_DISALLOWED_PATHS=node_modules/,.venv/,venv/,vendor/,dist-packages/,site-packages/
AUTO_PUBLISH_ON_GREEN=false
AUTO_APPROVE_WITHOUT_JUDGER=false
AUTO_PUBLISH_EXCLUDED_CATEGORIES=security,automation,filesystem,network
```

### Frontend Variables

Frontend variables are also in the same root `.env`:

```bash
VITE_API_BASE_URL=http://localhost:3040
VITE_USE_API_PROXY=true
```

### Provider Profiles

Agent-oriented provider profiles and auto-publish tuning (SQLite only, MySQL only,
and mixed-mode cutover workflows) are documented in:

[`docs/product/AGENT_OPERATIONS.md`](../product/AGENT_OPERATIONS.md)

## 4. Start Servers

### Option A: Development Mode With `tsx`

```bash
# Start from repository root (both apps)
npm run dev
```

- Frontend: http://localhost:3041
- API: http://localhost:3040

### Option B: Production Build

```bash
npm run build:prod
node apps/api/dist/server.js
```

The frontend is served by the same `npm run dev`/start flow; for pure production
preview after a build, use `npm run dev` from the repo root.

## 5. Automated Smoke Test

```bash
bash scripts/smoke-test.sh
```

This script:

- starts the backend in the background using the production build
- waits until the server is reachable
- tests public endpoints: `/discover`, `/skills`, `/skills/search`
- tests admin login and skill creation
- tests proposal workflow
- stops the backend again

To include a real non-noop judgement provider:

```bash
EXPECT_REAL_JUDGER=true bash scripts/smoke-test.sh
```

Prerequisites:

- root `.env` contains a working non-noop judging setup.
- for custom judger providers, follow
  [`docs/setup/JUDGER_ADAPTERS.md`](./JUDGER_ADAPTERS.md).

### Deterministic EPIC-008 Proof Scripts

The lightweight deterministic proof scripts run as part of `./scripts/check.sh` and write stable evidence artifacts under `.tmp/`:

| Script | Proof artifacts | Purpose |
|---|---|---|
| `scripts/check-agent-auth-matrix.ts` | `.tmp/agent-auth-matrix.log/json` | Auth route-group permutations |
| `scripts/check-oidc-provider.ts` | `.tmp/oidc-provider.log/json` | Real local discovery/JWKS, access-token, rotation, and outage behavior |
| `scripts/check-judger-autopublish-matrix.ts` | `.tmp/judger-autopublish-matrix.log/json` | Judger availability and auto-publish safety permutations |
| `scripts/check-agent-contract.ts` | `.tmp/agent-contract.log/json` | Discovery, how-to-propose, setup-script contract consistency |
| `scripts/check-admin-ui-smoke.ts` | `.tmp/admin-ui-smoke.log/json` | Lightweight source-contract proof for admin/public UI wiring |
| `scripts/check-openapi-parity.ts` | `.tmp/openapi-parity.log/json` | Implemented agent-facing routes vs. OpenAPI |
| `scripts/check-provider-matrix.ts` | `.tmp/provider-matrix.log/json` | SQLite provider subset by default; full SQLite/MySQL matrix in the MySQL full-check gate |
| `scripts/check-provider-cutover.ts` | `.tmp/provider-cutover.log/json` | SQLite-to-MySQL cutover proof in the MySQL full-check gate |
| `scripts/check-skill-package-downloads.ts` | `.tmp/skill-package-downloads.log/json` | Published skill package download behavior |
| `scripts/check-proposal-lifecycle.ts` | `.tmp/proposal-lifecycle.log/json` | Agent proposal upload/finalize/admin conversion lifecycle |
| `scripts/check-concurrency-abuse.ts` | `.tmp/concurrency-abuse.log/json` | Proposal state guards and malformed package path rejection |
| `scripts/check-observability-audit.ts` | `.tmp/observability-audit.log/json` | Observability exports and audit evidence |
| `scripts/check-public-release-hygiene.sh` | `.tmp/public-release-hygiene.log/json` | Public release metadata, secrets, private files, and history hygiene |

Extended checks are grouped under:

```bash
./scripts/full-check.sh
```

Optional gates:

```bash
RUN_SMOKE_TEST=true ./scripts/full-check.sh
RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh
RUN_AUTHENTIK_STAGING_CHECK=true AUTHENTIK_STAGING_ACCESS_TOKEN='...' AUTHENTIK_STAGING_ID_TOKEN='...' AUTHENTIK_STAGING_EVIDENCE_FILE=/secure/path/evidence.json ./scripts/full-check.sh
```

The full check always runs the isolated backup/restore proof after the baseline
check. `RUN_MYSQL_FULL_CHECK=true` adds all SQLite/MySQL provider combinations.
`RUN_AUTHENTIK_STAGING_CHECK=true` adds the live provider/token checks and
requires the fresh manual evidence contract from `docs/setup/AUTHENTIK.md`.

### Agent API Auth Matrix

The `none`, static bearer, and OIDC permutations are documented and covered in
[`docs/setup/AGENT_API_AUTH_TEST_MATRIX.md`](./AGENT_API_AUTH_TEST_MATRIX.md).
Run `./scripts/check.sh` to execute all 27 independent discovery/read/proposal
combinations and generate `.tmp/agent-auth-matrix.log` plus
`.tmp/agent-auth-matrix.json`.

### Deterministic And Real OIDC Proofs

`scripts/check-oidc-provider.ts` binds a local loopback provider and runs the
production verifier against real `openid-client` discovery and `jose` remote
JWKS behavior. It proves Authentik-shaped access tokens, independently validates
a realistic `typ=JWT` ID token with `at_hash`, rejects that valid ID token as an
API access token, and proves key rotation, stable ownership, and fail-closed
outage behavior without an external dependency.

This does not activate production. The optional real Authentik gate additionally
requires a short-lived token obtained through Device Authorization and a fresh,
anonymous schema-v2 staging evidence file. The access and ID tokens must come
from one Token Endpoint response. See `docs/setup/AUTHENTIK.md`.

### Judger And Auto-Publish Matrix

`./scripts/check.sh` also runs `scripts/check-judger-autopublish-matrix.ts`.
It validates deterministic noop, green, risky, classifier-blocked, classifier-failed, and missing-classifier cases without external LLM calls.
Successful runs generate `.tmp/judger-autopublish-matrix.log` and `.tmp/judger-autopublish-matrix.json`.

### Admin UI Smoke Proof

`./scripts/check.sh` runs `scripts/check-admin-ui-smoke.ts` as a lightweight
source-contract proof. It validates public routes outside the admin guard,
simple/OIDC login wiring, session-expiry guidance, role routes and actions,
authenticated-only navigation, config-aware setup UI, not-judged proposal
display, and reachable proposal review/draft flows.
Successful runs generate `.tmp/admin-ui-smoke.log` and `.tmp/admin-ui-smoke.json`.

#
## Content Migration

`scripts/check-content-migration.ts` proves deterministic filesystem-to-database migration against an isolated `DATA_DIR`. It creates a filesystem-backed skill/proposal fixture, runs `scripts/migrate-content-to-database.ts`, reopens the same data directory in database-content mode, verifies migrated aggregates/files/audits, and verifies source filesystem artifacts were not deleted.

Artifacts:

- `.tmp/content-migration.log`
- `.tmp/content-migration.json`
- `.tmp/migrate-content-to-database.log`
- `.tmp/migrate-content-to-database.json`

This proof is part of `./scripts/check.sh`.

## Content Export

`scripts/check-content-export.ts` proves deterministic database-to-filesystem export against isolated data directories. It creates a SQLite database-content source fixture, runs `scripts/export-content-filesystem.ts` into a separate target `DATA_DIR`, reopens the target in filesystem mode, and verifies skill/proposal aggregates, raw files, nested paths, extracted content, skill-scoped audit entries, and global audit entries.

The export command requires `CONTENT_EXPORT_DATA_DIR`, refuses to write into the active `DATA_DIR`, and refuses to overwrite an existing target unless `CONTENT_EXPORT_OVERWRITE=true` is set.

Artifacts:

- `.tmp/content-export.log`
- `.tmp/content-export.json`
- `.tmp/export-content-filesystem.log`
- `.tmp/export-content-filesystem.json`

This proof is part of `./scripts/check.sh`.

## Content Storage Matrix

`scripts/check-content-storage-matrix.ts` proves that filesystem-backed content storage and SQLite database-backed content storage are black-box equivalent for the covered public API and download paths. It creates the same published skill fixture in both modes, compares scrubbed JSON responses, compares direct file bytes, compares package ZIP bytes, and verifies database mode does not create managed `data/skills` or `data/proposals` directories.

Artifacts:

- `.tmp/content-storage-matrix.log`
- `.tmp/content-storage-matrix.json`

This proof is part of `./scripts/check.sh` for filesystem/sqlite versus database/sqlite. `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` runs the same proof with `CONTENT_STORAGE_MATRIX_INCLUDE_MYSQL=true`, adding filesystem/mysql versus database/mysql parity.

## Provider Matrix

`./scripts/check.sh` runs `scripts/check-provider-matrix.ts` in default mode and proves the `sqlite/sqlite` public read path without Docker.

For the full local provider matrix, run:

```bash
RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh
```

That path starts the local MySQL/phpMyAdmin stack, publishes a deterministic fixture skill in isolated data directories, rebuilds projections with `clearProjections=true`, and compares MySQL-backed provider combinations against the SQLite public endpoint baseline.
Successful runs generate `.tmp/provider-matrix.log` and `.tmp/provider-matrix.json`.


### Skill Package Downloads

`./scripts/check.sh` runs `scripts/check-skill-package-downloads.ts` to prove that agents can download published skill versions deterministically.
It validates direct single-file `SKILL.md` downloads, multi-file ZIP downloads, blocked draft versions, and unknown-skill 404 behavior.
Successful runs generate `.tmp/skill-package-downloads.log` and `.tmp/skill-package-downloads.json`.

### Concurrency And Abuse Proof

`./scripts/check.sh` runs `scripts/check-concurrency-abuse.ts` to prove that repeated proposal state transitions and malformed package paths fail safely.
It validates double-finalize, upload-after-finalize, double-convert, traversal path rejection, valid path normalization, duplicate upload rejection, HTTP file count and size limits, concurrent projection rebuild stability, and package-download validation errors for unsafe adapter paths.
Successful runs generate `.tmp/concurrency-abuse.log` and `.tmp/concurrency-abuse.json`.

### Proposal Lifecycle Proof

`./scripts/check.sh` runs `scripts/check-proposal-lifecycle.ts` against an isolated SQLite-backed `.tmp` data directory. It validates how-to guidance, deterministic similar duplicate candidates, proposal creation, blocked dependency uploads, broken local reference blocking, file upload, finalization, proposal/file judgement creation, public status, admin conversion, draft non-public visibility, admin publish, admin rejection, and state-blocked delete behavior.

### Observability And Audit Proof

`./scripts/check.sh` runs `scripts/check-observability-audit.ts` to prove that deterministic request observations and audit entries produce operator-visible evidence.
It validates retrieval, proposal, auth, review, publish, and observability evidence, proposal-scoped recent requests, JSON and CSV observability exports, and audit entries for submit, attach, finalize, convert, publish, reject, and projection rebuild actions.
Successful runs generate `.tmp/observability-audit.log` and `.tmp/observability-audit.json`.

### Backup And Restore Proof

`./scripts/full-check.sh` runs `scripts/check-backup-restore.ts` with `MSH_SKIP_ENV=true` and `MSH_SKIP_STOP=true` against `.tmp/backup-restore-proof/data`.
It validates archive creation, restore completion, restored skill/proposal/audit/projection data, and creation of a pre-restore safety copy.
Successful runs generate `.tmp/backup-restore.log` and `.tmp/backup-restore.json`.

### MySQL Provider Migration Check

To validate provider cutover in a staging-like workflow:

1. Run a clean SQLite baseline via normal startup (`CATALOG_PROVIDER=sqlite`,
   `SEARCH_PROVIDER=sqlite`).
2. Log in as admin and record session cookies in `cookies.txt`.
3. Switch to MySQL providers:

```bash
CATALOG_PROVIDER=mysql
SEARCH_PROVIDER=mysql
```

4. Start the API and rebuild projections from primary state:

```bash
curl -b cookies.txt -X POST \
  "http://localhost:3040/admin/projections/rebuild?clearProjections=true"
```

5. Re-run core endpoint checks:

```bash
curl -s http://localhost:3040/discover | jq
curl -s "http://localhost:3040/skills/search?q=create" | jq
curl -s "http://localhost:3040/skills" | jq
curl -s http://localhost:3040/skills/suggest-name?title=Angular%20Testing | jq
```

6. Compare responses for expected parity and switch traffic only after parity checks
   pass.

## 6. Manual API Tests With curl

All commands assume the backend is running on `http://localhost:3040`.

### Healthcheck

```bash
curl -s http://localhost:3040/api/health | jq
```

### Discovery

```bash
curl -s http://localhost:3040/discover | jq
```

### Public Skill List

```bash
curl -s http://localhost:3040/skills | jq
```

### Read Proposal Contract

```bash
curl -s http://localhost:3040/howToPropose | jq
```

### Read Public Skill

```bash
curl -s http://localhost:3040/skills | jq
```

### Search: Keyword/BM25

```bash
curl -s "http://localhost:3040/skills/search?q=create" | jq
```

### Search: Fulltext

```bash
curl -s "http://localhost:3040/skills/search?q=skill&mode=fulltext" | jq
```

### Search: Regex

```bash
curl -s "http://localhost:3040/skills/search?q=how.*skill&mode=regex" | jq
```

### Group Filter

```bash
curl -s "http://localhost:3040/skills?group=documentation" | jq
```

### Name Suggestion

```bash
curl -s "http://localhost:3040/skills/suggest-name?title=Angular%20Testing" | jq
```

### Skill Versions And History

```bash
curl -s http://localhost:3040/skills/<skill-id>/versions | jq
curl -s http://localhost:3040/skills/<skill-id>/history | jq
```

## 7. Admin Tests

### Login

```bash
curl -s -X POST http://localhost:3040/admin/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"username":"admin","password":"admin"}' | jq
```

### Create Skill

```bash
curl -s -X POST http://localhost:3040/admin/skills \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "id": "my-admin-test-skill",
    "title": "My Admin Test Skill",
    "description": "A test skill created through the admin API.",
    "entrypoint": "README.md",
    "groups": ["test", "examples"],
    "capabilities": ["demo"]
  }' | jq
```

### Submit Skill For Review

```bash
curl -s -X POST http://localhost:3040/admin/skills/my-admin-test-skill/submit-review \
  -b cookies.txt | jq
```

### Approve Skill

```bash
curl -s -X POST "http://localhost:3040/admin/skills/my-admin-test-skill/approve?version=1.0.0" \
  -b cookies.txt | jq
```

### Publish Skill

```bash
curl -s -X POST "http://localhost:3040/admin/skills/my-admin-test-skill/publish?version=1.0.0" \
  -b cookies.txt | jq
```

### Mark Skill Deprecated

```bash
curl -s -X POST "http://localhost:3040/admin/skills/my-admin-test-skill/deprecate?version=1.0.0" \
  -b cookies.txt | jq
```

### Logout

```bash
curl -s -X POST http://localhost:3040/admin/logout \
  -b cookies.txt -c cookies.txt | jq
```

## 8. Proposal Tests

### Submit Proposal

```bash
curl -s -X POST http://localhost:3040/proposals \
  -H "Content-Type: application/json" \
  -H "X-Actor: test-agent" \
  -d '{
    "title": "Test Proposal",
    "description": "A proposal for testing the workflow.",
    "groups": ["test"],
    "capabilities": ["demo"]
  }' | jq
```

### Read Proposal In Admin And Check Judgements

First log in as admin and create `cookies.txt`:

```bash
curl -s -X POST http://localhost:3040/admin/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"username":"admin","password":"admin"}' | jq
```

```bash
curl -s -b cookies.txt http://localhost:3040/admin/proposals/$PROPOSAL_ID | jq
curl -s -b cookies.txt http://localhost:3040/admin/judgements/proposal/$PROPOSAL_ID | jq
```

When a file was attached:

```bash
curl -s -b cookies.txt http://localhost:3040/admin/judgements/file/${PROPOSAL_ID}:README.md | jq
```

### On-Demand Skill Judgement

```bash
curl -s -X POST \
  -b cookies.txt \
  http://localhost:3040/admin/judge/skill/<skill-id>/version/<version> | jq
```

### Admin Proposal Reject/Convert

First log in as admin:

```bash
curl -s -X POST http://localhost:3040/admin/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"username":"admin","password":"admin"}' | jq
```

Reject proposal:

```bash
curl -s -X POST http://localhost:3040/admin/proposals/$PROPOSAL_ID/reject \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"reason":"Still incomplete"}' | jq
```

Or convert a new proposal into a skill:

```bash
curl -s -X POST http://localhost:3040/admin/proposals/$PROPOSAL_ID/convert \
  -b cookies.txt | jq
```

If `proposal.skillId` points to an existing skill, conversion creates a new
draft version for that skill.

The response contains the proposal `id`, for example `prop-...`. Use it for the
next calls.

### Attach File To Proposal

```bash
PROPOSAL_ID="prop-..."
echo "# Test File" > /tmp/test-readme.md
curl -s -X POST "http://localhost:3040/proposals/${PROPOSAL_ID}/files" \
  -H "X-Actor: test-agent" \
  -F "file=@/tmp/test-readme.md;filename=README.md" | jq
```

### Read Proposal In Admin

```bash
curl -s -b cookies.txt "http://localhost:3040/admin/proposals/${PROPOSAL_ID}" | jq
```

### List All Proposals In Admin

```bash
curl -s -b cookies.txt http://localhost:3040/admin/proposals | jq
```

### Judge Proposal Explicitly

```bash
curl -s -X POST \
  -b cookies.txt \
  "http://localhost:3040/admin/proposals/${PROPOSAL_ID}/judge" | jq
```

## 9. UI Tests

- Open http://localhost:3041 in the browser.
- Public UI: skill search and skill detail without login.
- Admin UI: http://localhost:3041/admin/login with `admin` and your password.
- In the admin area: list skills, inspect proposals, and test the approval
  workflow.

## 10. Test Agentic Proposal Preflight

- Fetch and validate `GET /howToPropose`.
- Check the local proposal package against the described contract:
  - final entrypoint `SKILL.md`
  - temporary normalization only when needed
  - self-contained references
  - no credentials or obvious PII
  - file count / file size / blocked path prefixes within the configured upload limits
- Before `POST /proposals`, build the final temporary upload package, scan every
  readable file for outside-root/workspace references, compute SHA-256 values
  from that final package, and use those final hashes for duplicate check.
- Then run `POST /proposals/check-duplicate`, `POST /proposals`, and file
  uploads manually or through the local agent, then explicitly call
  `POST /proposals/{id}/finalize-upload`.

## 11. Test Backup/Restore

```bash
# Create backup
bash scripts/backup.sh

# Run restore; replace <backup> with the generated path
ls -1 data/backups/*.tar.gz | tail -n 1
bash scripts/restore.sh data/backups/managed-skill-hub-data-...
```

## 12. Troubleshooting

### `tsx watch` Does Not Start

In some sandbox environments, `tsx` cannot create an IPC pipe. It should work
locally. Alternative:

```bash
cd apps/api
npm run build:prod
node dist/server.js
```

### `listen EPERM` In The Sandbox

Binding to `127.0.0.1:3040` is blocked in restrictive sandboxes. Locally this
is not a problem. When in doubt, check the port:

```bash
lsof -nP -iTCP:3002 -sTCP:LISTEN
```

### Simple Admin Credentials Are Missing

```bash
echo "ADMIN_PASSWORD=admin" >> .env
```

This applies only to `ADMIN_AUTH_MODE=simple`. OIDC mode must leave simple
credentials and `JWT_SECRET` absent and instead configure both Authentik
provider boundaries.

### Database Lock Or FTS5 Error

Delete `data/index/search.db` and restart the server. The index is recreated on
demand.

```bash
rm -f data/index/search.db
```

### CORS Problems In The Frontend

Frontend and backend must be reachable over HTTP, not over different ports via
`file://`. Defaults:

- Backend: http://localhost:3040
- Frontend: http://localhost:3041

### Frontend Does Not Build

```bash
cd apps/web
npm run typecheck
npm run build:prod
```

## 13. What Does Not Work Yet: MVP Boundaries

- Authentik runtime support exists, but production activation remains dependent
  on the target deployment's real staging gate.
- Real LLM judgements are missing; by default `JUDGER_PROVIDER=noop` blocks
  auto-publish because judgements are treated as not-judged unless
  `AUTO_APPROVE_WITHOUT_JUDGER=true`.
- Semantic/vector search is not implemented.
- MCP server is not implemented.
- Backups must be run manually.
