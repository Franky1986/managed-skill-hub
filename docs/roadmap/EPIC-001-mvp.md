# EPIC-001: managed-skill-hub MVP

## Goal

Build a fully functional self-hosted skill registry that:

- can be consumed by agents through a public REST API,
- can be managed by admins through a protected web UI,
- supports proposals including LLM judgement and approval workflow,
- stores data file-based in `data/`, and
- is easy to deploy.

## Boundaries

- No production deployment.
- No authentik integration yet.
- No custom-judger integration; judger starts as stub.
- No automatic backups yet.

## Work Packages

### AP-01: Project Structure And Package Setup

**Goal:** Monorepo structure with workspaces, TypeScript, Fastify, React.

**Deliverables:**

- root `package.json` with workspaces
- `apps/api/package.json`
- `apps/web/package.json`
- `packages/openapi/package.json`
- `tsconfig.json` files
- `./scripts/check.sh` expanded to lint/typecheck

### AP-02: OpenAPI Contract

**Goal:** Central OpenAPI spec for all endpoints.

**Deliverables:**

- `packages/openapi/skill-registry.openapi.yaml`
- public read API
- proposal API
- judgement API
- admin command API
- skill-name suggestion API
- generated TypeScript client for frontend

### AP-03: Domain Entities

**Goal:** Domain without infrastructure dependencies.

**Deliverables:**

- `apps/api/src/domain/skill/Skill.ts`
- `apps/api/src/domain/skill/SkillVersion.ts`
- `apps/api/src/domain/skill/SkillId.ts`
- `apps/api/src/domain/skill/SkillStatus.ts`
- `apps/api/src/domain/skill/Manifest.ts`
- `apps/api/src/domain/proposal/Proposal.ts`
- `apps/api/src/domain/proposal/ProposalStatus.ts`
- `apps/api/src/domain/judgement/Judgement.ts`
- `apps/api/src/domain/judgement/JudgementDimensions.ts`
- domain tests

### AP-04: Port Interfaces

**Goal:** Clean hexagonal ports.

**Deliverables:**

- Inbound ports: SkillQueryPort, SkillCommandPort, ProposalCommandPort,
  SkillNameSuggestionPort.
- Outbound ports: SkillRepositoryPort, SkillFileStoragePort, SkillSearchPort,
  AuditLogPort, SkillJudgerPort, FileScannerPort.

### AP-05: Application Use Cases

**Goal:** Orchestration between domain and ports.

**Deliverables:**

- use cases for public read
- use cases for admin commands
- use cases for proposals
- use cases for name suggestion
- use cases for judgement with stub adapter
- application tests with in-memory adapters

### AP-06: File-Based Storage Adapter

**Goal:** Persistence in `data/skills/` and `data/proposals/`.

**Deliverables:**

- `apps/api/src/adapters/outbound/persistence/filesystem/FileSystemSkillRepository.ts`
- `apps/api/src/adapters/outbound/persistence/filesystem/FileSystemProposalRepository.ts`
- `apps/api/src/adapters/outbound/persistence/filesystem/FileSystemSkillFileStorage.ts`
- `apps/api/src/adapters/outbound/audit/filesystem/FileSystemAuditLog.ts`
- atomic writes
- integration tests

### AP-07: SQLite FTS5 Search Adapter

**Goal:** Search across skills.

**Deliverables:**

- `apps/api/src/adapters/outbound/search/sqlite/SqliteSkillSearch.ts`
- index update on writes
- BM25 search
- regex search with timeout
- group filter
- reindex command

### AP-08: File Scanner Adapter

**Goal:** Text extraction from supported file types.

**Deliverables:**

- `apps/api/src/adapters/outbound/scanner/FileScanner.ts`
- native Markdown, YAML, JSON, TXT
- PDF, DOCX, XLSX, CSV through parser
- integration tests

### AP-09: LLM Judger Stub

**Goal:** Prepare the port without custom-judger.

**Deliverables:**

- `apps/api/src/adapters/outbound/judger/NoopSkillJudger.ts`
- `apps/api/src/adapters/outbound/judger/StubSkillJudger.ts`, optional with
  fixed sample values
- integration into use cases

### AP-10: HTTP Adapter / Fastify API

**Goal:** Implement REST API.

**Deliverables:**

- `apps/api/src/adapters/inbound/http/SkillReadController.ts`
- `apps/api/src/adapters/inbound/http/AdminSkillController.ts`
- `apps/api/src/adapters/inbound/http/ProposalController.ts`
- `apps/api/src/adapters/inbound/http/JudgementController.ts`
- `apps/api/src/adapters/inbound/http/SkillNameSuggestionController.ts`
- `apps/api/src/adapters/inbound/http/HealthcheckController.ts`
- `apps/api/src/adapters/inbound/http/SimpleAdminAuth.ts`
- OpenAPI validation
- integration tests

### AP-11: Simple Admin Auth

**Goal:** Login with user/password from `.env`.

**Deliverables:**

- `POST /admin/login`
- `POST /admin/logout`
- session cookie with JWT
- middleware for admin routes
- integration tests

### AP-12: React Admin UI

**Goal:** Web UI for admins.

**Deliverables:**

- login page
- skill list
- skill detail with preview
- skill editor
- proposal list with judgements
- approval workflow: approve/publish/deprecate
- audit log view

### AP-13: React Public UI

**Goal:** Web UI for humans without admin rights.

**Deliverables:**

- skill search
- skill detail with preview
- group filter

### AP-14: Agentic Proposal Preflight For Complex Uploads

**Goal:** Deterministic upload contract for local agents.

**Deliverables:**

- `GET /discover` plus `GET /howToPropose` as canonical agent instruction
- local package inspection and normalization when needed in the agent flow
- return proposal UUID through the API

### AP-15: Checks, Lint, Tests

**Goal:** Quality assurance.

**Deliverables:**

- ESLint + Prettier
- TypeScript strict
- domain tests
- application tests
- adapter integration tests
- `./scripts/check.sh` runs everything

### AP-16: Example Skills

**Goal:** Project is immediately usable.

**Deliverables:**

- `data/skills/how-to-create-a-skill/` with a skill for using the registry
- sample manifest, README, files

### AP-17: Complete Deployment Scripts

**Goal:** Deploy mechanism works; do not deploy.

**Deliverables:**

- `scripts/deployment/create-deploy-archive.sh` tested
- `scripts/deployment/install_and_start.sh` tested
- `scripts/deployment/restart-server.sh` tested
- `scripts/operations/backup.sh` and `scripts/operations/restore.sh` present
- documentation current

## Epic Acceptance Criteria

- `./scripts/check.sh` passes.
- All ADRs and specs are consistent and current.
- API can be started locally.
- Public endpoints return only `published` skills.
- Admin endpoints are protected by auth.
- Proposals can be submitted and viewed by admins.
- Judgements are stored for proposals.
- Search works with BM25 and regex.
- UI is reachable and shows skills/proposals.
- No deploy is performed.

## Configuration Defaults

| Setting | Value |
|---------|-------|
| Runtime development | `tsx` |
| Maximum upload file size | 5 MB |
| Session cookie name | `skill_hub_session` |
| Local DATA_DIR | `./data` |
| Server DATA_DIR | `/path/to/deploy-root/data` |
| Tika container | not in MVP yet |

## Behavior Rules

- Proposals are automatically judged immediately after upload
  (`SkillJudgerPort`).
- Every file attached to a proposal is judged individually.
- Judgement uses extracted text via `FileScannerPort` /
  `@llamaindex/liteparse` plus metadata, not the raw file.
- Judgements are stored in the proposal and displayed in admin.
- `SkillJudgerPort` is a stub/noop adapter in the MVP; custom-judger is connected
  later.

## Order

1. AP-01: setup
2. AP-02: OpenAPI
3. AP-03: domain
4. AP-04: ports
5. AP-05: use cases
6. AP-06 + AP-07 + AP-08 + AP-09: adapters
7. AP-10 + AP-11: HTTP API + auth
8. AP-12 + AP-13: UI
