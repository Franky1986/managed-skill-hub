# MASTER_PLAN - managed-skill-hub

## Vision

An internal, managed skill registry that lets product managers and developers
create, version, review, and approve skills for AI agents. Agents such as Codex,
Claude, OpenCode, Gemini, Cursor, and Windsurf can discover, load, and apply
these skills autonomously.

## Non-Goals

- No public marketplace.
- No multitenancy in the MVP.
- No semantic vector search in the MVP.
- No MCP server in the MVP; prepared but expanded only in phase 2.
- No complex RBAC governance in the MVP; only admin vs. public read path.

## Current Phase

Phase 1 MVP foundation is implemented. EPIC-002, Agent Workbench UI and registry
hardening, is functionally complete. EPIC-003 is moving the project to
English-first docs, specs, UI localization, and agent-facing contracts.

## Target Architecture

- Hexagonal Architecture plus Domain-Driven Design.
- OpenAPI as contract layer.
- TypeScript backend with Fastify and React frontend.
- File-based artifact storage in `data/skills/`.
- SQLite FTS5 search index in `data/index/`.
- SQLite metadata projection as domain truth and read layer for large parts of
  retrieval and review.
- Simple session-protected admin path today; authentik/OIDC later.
- Public read and proposal paths are open by default, with configurable agent/API auth planned in EPIC-007.
- Ports for storage, search, audit, and auth to enable later migration.

## Major Epics

1. **Domain & API Contract**
   - Define OpenAPI spec.
   - Domain model: Skill, SkillVersion, SkillFile, Approval, AuditEntry.
   - Use cases for public read and admin commands.

2. **File-Based Persistence & Storage Port**
   - Skill folder structure under `data/skills/`.
   - Atomic writes through temp folder plus rename.
   - Local file storage adapter.

3. **Search Port & SQLite FTS5 Index**
   - Search modes: keyword/BM25, fulltext, regex.
   - Index from manifest plus extracted text.
   - Reindex command.

4. **Public REST API**
   - `GET /discover`
   - `GET /skills`
   - `GET /skills/search`
   - `GET /skills/:id`
   - `GET /skills/:id/manifest`
   - `GET /skills/:id/files`
   - `GET /skills/:id/files/:fileId`
   - `GET /skills/:id/versions`
   - `GET /skills/:id/history`

5. **Admin API & authentik**
   - Create / update skill.
   - Upload files.
   - Submit for review / approve / publish / deprecate.
   - Audit log.

6. **React Admin UI**
   - Skill list, detail, editor, review workflow, audit log.

7. **Deployment & Operations**
   - Separation of `src/` and `data/`.
   - Deploy script that leaves `data/` untouched.
   - Backup rules.

8. **English-First Localization And Agent-Facing Contracts**
   - English canonical docs, specs, OpenAPI, and agent-facing guidance.
   - English-default UI with German toggle.
   - Agent endpoints remain English and instruct agents to answer users in the
     user's current language.

9. **Configurable Agent API Authentication**
   - Optional bearer authentication for published-skill consumption.
   - Optional bearer authentication for proposal submission and status polling.
   - Discovery/OpenAPI contracts that tell agents which auth mode is active.

10. **Deterministic Validation And Release Proofing**
   - Script-driven proof artifacts for provider, judger, proposal, download, agent-contract, hygiene, backup/restore, and OpenAPI parity checks.
   - Lightweight checks in `./scripts/check.sh`; extended infrastructure checks in `./scripts/full-check.sh` and `.github/workflows/validation.yml`.

11. **Database-Backed Content Storage**
   - Optional `CONTENT_STORAGE_PROVIDER=database` mode for storing managed skill files, proposal uploads, extracted content, aggregate state, and audit content in the selected database instead of the filesystem.
   - Migration, backup/restore, and deterministic proofing for filesystem and database content modes.

12. **Portable Agent Command Artifacts**
   - Optional `commands/` package convention for reusable agent command
     shortcuts.
   - Consumer-side mapping hints for Cursor, Codex, Claude Code, and generic
     command folders without leaking submitter-workspace paths.

## Dependency Order

1. OpenAPI contract and domain model.
2. Storage port plus local adapter.
3. Search port plus SQLite FTS5 adapter.
4. Public read API.
5. Admin command API.
6. React UI.
7. Deployment/backup.
8. Localization and agent-facing contract hardening.
9. Configurable agent API authentication.
10. Deterministic validation and release proofing.
11. Database-backed content storage.
12. Portable agent command artifacts.

## Definition Of Done Per Epic

- Specs for affected boundaries exist and are current.
- Use cases are covered with domain tests.
- Adapters have contract/integration tests.
- API endpoints are documented through OpenAPI.
- `CURRENT_STATUS.md`, `NEXT_STEPS.md`, and `CHANGELOG_INTERNAL.md` are updated.
- `./scripts/check.sh` passes.
