# EPIC-009: Database-Backed Content Storage

## Status

Implemented for the first relational storage stage. Database-backed content storage is available for SQLite and MySQL provider modes with deterministic runtime parity proofs, filesystem-to-database migration, database-to-filesystem export, global audit migration/export support, and guarded backup/restore semantics.

## Goal

Introduce a runtime configuration option that lets operators store all managed skill and proposal content in the configured database instead of the local filesystem.

The intended operator-facing switch is:

```bash
CONTENT_STORAGE_PROVIDER=filesystem # default
CONTENT_STORAGE_PROVIDER=database
```

`filesystem` keeps the current behavior. `database` means managed skill files, proposal uploads, extracted content, manifests/proposal aggregate state, and storage metadata are persisted through database-backed adapters.

## Why This Matters

The current system already supports configurable relational providers for catalog and search projections (`sqlite` or `mysql`), but original artifacts are still stored in `DATA_DIR` on disk. That is simple for local use, but it creates deployment and operational friction when users want a server setup where the database is the durable source for all managed registry content.

Database-backed content storage would make MySQL deployments easier to operate as a single durable persistence tier and reduce the chance that filesystem files and relational projections drift apart.

## Non-Goals

- Do not remove the filesystem mode. It remains the default and the simplest local setup.
- Do not make search provider and content storage provider the same concept. Search remains `SEARCH_PROVIDER`; content blobs and aggregate state use the new content storage setting.
- Do not implement object storage/S3 in this epic. The design should not block it later, but this epic targets relational database storage first.
- Do not put database-specific logic into domain objects or use cases.
- Do not require a live MySQL instance for the lightweight `./scripts/check.sh` path.

## Original-State Analysis

### Existing Provider Split

- `CATALOG_PROVIDER=sqlite|mysql` controls relational metadata and review projections.
- `SEARCH_PROVIDER=sqlite|mysql` controls search indexing.
- `SkillFileStoragePort` already abstracts skill/proposal file content and extracted text.
- Before EPIC-009, `SkillRepositoryPort` was implemented only by `FileSystemSkillRepository`, which writes and reads `skill.yaml` and `proposal.yaml` from `DATA_DIR`.
- `AuditLogPort` is still implemented by `FileSystemAuditLog`, with JSONL files under `data/audit/`.
- `FileBackedObservability` writes the HTTP observability snapshot below `DATA_DIR`; observability is intentionally outside managed-content scope for this epic.

### Filesystem Dependencies That Must Be Addressed

- `apps/api/src/adapters/outbound/persistence/filesystem/file-system.storage.ts` stores raw skill files, proposal files, `.meta.json`, and `.extracts.json`.
- `apps/api/src/adapters/outbound/persistence/filesystem/file-system.repository.ts` stores aggregate state in `skill.yaml` and `proposal.yaml`.
- `apps/api/src/adapters/outbound/audit/filesystem/file-system.audit.ts` stores audit entries in JSONL files and mirrors them into the catalog projection.
- `apps/api/src/adapters/outbound/observability/file-backed.observability.ts` stores observability snapshots on disk.
- Before EPIC-009, catalog adapters read `data/skills/**/.meta.json` to resolve version `updatedAt`; database mode now bridges metadata from content tables.
- `scripts/backup.sh` and `scripts/restore.sh` back up and restore filesystem-side `DATA_DIR` content, with a fail-fast guard for MySQL database-content mode.
- `docs/setup/BACKUP_AND_RESTORE.md`, `docs/setup/DEPLOYMENT.md`, `docs/setup/ENVIRONMENT.md`, `docs/architecture/SYSTEM_OVERVIEW.md`, `docs/decisions/ADR-005-filebased-storage.md`, and `docs/decisions/ADR-013-sqlite-metadata-truth.md` describe the filesystem as the physical source for artifacts.

### Current Runtime Flow

1. Use cases save domain aggregates through `SkillRepositoryPort`.
2. Use cases save or read raw files/extracts through `SkillFileStoragePort`.
3. Catalog/search projections are updated after writes.
4. Public reads mostly use catalog/search for metadata, but file downloads still read raw content through `SkillFileStoragePort`.
5. Rebuild operations reconstruct projections by loading aggregates from `SkillRepositoryPort` and file content from `SkillFileStoragePort`.

This means a database content mode needs both a database-backed file storage adapter and a database-backed repository adapter. Implementing only file blobs would leave the aggregate source of truth on disk.

## External Contract Parity

Database-backed content storage must be a black-box equivalent of filesystem-backed content storage. No public, admin, frontend, or agent-facing behavior may change because of the selected content storage provider.

Mandatory parity points:

- Public API responses for discovery, listing, search, manifests, file listings, file reads, package downloads, categories, and tags must remain schema-compatible and semantically identical.
- Admin API behavior for skill creation, proposal review, draft creation, publish, reject, reindex, rebuild, extraction, and judgement flows must remain identical.
- Frontend UX must not branch on storage mode except for optional operational diagnostics.
- Agent-facing guidance, OpenAPI contracts, auth behavior, proposal status polling, and package download workflows must remain unchanged.
- Byte-level file content, package ZIP content, SHA-256 values, content digests, artifact IDs, and version identifiers must be stable across storage providers.
- Search results and ordering must remain provider-neutral within the existing tolerance rules.

The implementation must add deterministic black-box parity proofs that run the same fixture and workflow through filesystem mode and database mode, then compare API responses, downloaded bytes, hashes, proposal lifecycle results, audit visibility, and rebuild/reindex results.

## Recommended Decisions

The recommended implementation path is:

1. Keep configuration minimal with `CONTENT_STORAGE_PROVIDER=filesystem|database` and no separate `CONTENT_DATABASE_PROVIDER` in the first implementation. In `database` mode, content storage follows `CATALOG_PROVIDER`. For example, `CATALOG_PROVIDER=mysql` plus `CONTENT_STORAGE_PROVIDER=database` means managed content is stored in MySQL.
2. Treat audit history as managed registry content. In database content mode, `AuditLogPort` should be database-backed so review, publish, reject, judgement, and rebuild history is not left on the filesystem.
3. Do not treat observability snapshots as managed content for this epic. Observability is operational telemetry and may remain file-backed initially. If needed later, add a separate `OBSERVABILITY_PROVIDER=file|database` decision.
4. In MySQL database-content mode, make `scripts/backup.sh` fail fast with explicit instructions instead of silently producing an incomplete `DATA_DIR` backup. Add a separate MySQL backup path later, for example `scripts/backup-mysql.sh`, once dump/restore semantics are explicit and tested.
5. Add a database-to-filesystem export command after database storage works. A command such as `scripts/export-content-filesystem.ts` should recreate a human-readable `data/skills/` and `data/proposals/` tree for debugging, portability, and vendor-lock-in avoidance.
6. Keep the existing upload/file-size limits for the first database-backed implementation and store content as database BLOBs. The port boundaries must remain clean enough to add object storage later without changing use cases or HTTP contracts.

Recommended implementation order:

1. Add config parsing, validation, container wiring, and specs.
2. Implement SQLite database-content adapters first so `./scripts/check.sh` can prove database-content mode without Docker.
3. Add black-box parity proof for `filesystem` versus `database/sqlite`.
4. Implement MySQL database-content adapters.
5. Extend `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` with MySQL content-storage parity.
6. Add deterministic filesystem-to-database migration.
7. Add deterministic database-to-filesystem export.
8. Update backup/restore documentation and add hard script guards for incomplete backup modes.

## Implemented Operational Model

EPIC-009 is implemented as an operationally safe two-way storage capability, not only as a one-way migration into database mode. Operators can move content into the database, validate parity, export it back to a readable filesystem tree, and see exactly which backup path is complete for their selected provider.

The implemented target behavior is:

- Local-first users keep `CONTENT_STORAGE_PROVIDER=filesystem` and need no migration. This remains the lowest-friction mode for development and small deployments.
- Server users who want database durability set `CONTENT_STORAGE_PROVIDER=database`. The concrete database follows `CATALOG_PROVIDER` for now, so SQLite stores content in the local SQLite database and MySQL stores content in MySQL content tables.
- No API, frontend, OpenAPI, agent, package-download, or proposal workflow changes are allowed because of this setting. Storage mode is an operator concern only.
- Migration must be copy-only and idempotent. Filesystem source data must stay untouched until the operator has run parity checks and made a separate cutover decision.
- Export back to filesystem is available through `scripts/export-content-filesystem.ts`. This keeps database mode inspectable, debuggable, portable, and reversible.
- MySQL database-content deployments must not rely on `DATA_DIR` archives alone. `scripts/backup.sh` fails fast in this mode so incomplete backups cannot be mistaken as complete. Operators must pair filesystem-side operational backups with a tested MySQL dump/restore workflow.

Implemented lifecycle commands and proofs:

1. `scripts/check-content-storage-matrix.ts` proves filesystem/database runtime parity for SQLite in `./scripts/check.sh` and for MySQL in `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh`.
2. `scripts/migrate-content-to-database.ts` copies filesystem content into database mode and `scripts/check-content-migration.ts` proves skills, proposals, files, extracts, scoped audits, global audits, and source preservation.
3. `scripts/export-content-filesystem.ts` exports database content back to a separate filesystem `DATA_DIR` and `scripts/check-content-export.ts` proves skills, proposals, nested files, extracts, scoped audits, and global audits.
4. `scripts/check-backup-restore.ts` proves filesystem backup/restore behavior and the MySQL database-content fail-fast backup guard.
5. MySQL database dump/restore automation is intentionally not implemented in this epic; the current contract is explicit guard plus documentation because the repo cannot safely infer each operator's production dump policy.

### Cutover Guidance

A safe filesystem-to-database cutover should follow this sequence:

1. Stop write traffic or put the registry into a maintenance window.
2. Keep the existing `DATA_DIR` unchanged and backed up.
3. Run the filesystem-to-database migration.
4. Start the API with `CONTENT_STORAGE_PROVIDER=database`.
5. Run the deterministic content-storage and migration checks against the target provider.
6. Validate package downloads and representative proposal/admin flows.
7. Keep the old filesystem data until at least one complete backup/restore cycle for the new mode has been validated.

### Rollback Guidance

Rollback is straightforward before new writes happen in database mode: switch `CONTENT_STORAGE_PROVIDER` back to `filesystem` and restart the API. After new writes happen in database mode, rollback requires a database-to-filesystem export first; otherwise new database-only content would be lost from the filesystem view.

## Proposed Configuration Model

```bash
# Physical source for managed content and aggregate state.
# Supported values: filesystem, database
CONTENT_STORAGE_PROVIDER=filesystem
```

Rules:

- `filesystem` uses `FileSystemSkillRepository`, `FileSystemSkillStorage`, `FileSystemAuditLog`, and `FileBackedObservability`.
- `database` uses database-backed adapters for repository, file storage, and audit. Observability remains operational telemetry and can stay file-backed in this epic.
- In `database` mode, the concrete relational backend should follow `CATALOG_PROVIDER` initially.
- `CONTENT_STORAGE_PROVIDER=database` with `CATALOG_PROVIDER=mysql` stores managed content in MySQL content tables and is covered by the MySQL full-check gate.
- `CONTENT_STORAGE_PROVIDER=database` with `CATALOG_PROVIDER=sqlite` stores content in SQLite under `DATA_DIR/index/search.db` or a clearly named database file. This keeps local database mode testable without Docker.
- `CONTENT_STORAGE_PROVIDER=database` must fail fast when the selected database backend is not configured or does not support content storage.

Implementation decision:

- First-stage database content storage follows `CATALOG_PROVIDER`. A separate `CONTENT_DATABASE_PROVIDER=sqlite|mysql` is deferred until a real mixed-deployment need appears.

## Proposed Database Model

New or extended tables should cover:

- `content_skill_aggregates`: skill aggregate state, versions, status transitions, timestamps, latest published marker.
- `content_proposal_aggregates`: proposal aggregate state, status, metadata, files, judgements, content digest.
- `content_skill_files`: `skill_id`, `version`, `path`, `mime_type`, `size_bytes`, `sha256`, `updated_at`, `content_blob`.
- `content_proposal_files`: `proposal_id`, `path`, `mime_type`, `size_bytes`, `sha256`, `updated_at`, `content_blob`.
- `content_skill_file_extracts`: `skill_id`, `version`, `path`, `text`, `extracted_by`, `metadata_json`, `extracted_at`.
- `content_proposal_file_extracts`: same shape for proposals.
- `content_audit_entries`: durable audit event storage equivalent to `AuditLogPort`.

The table design must keep `(skill_id, version, path)` and `(proposal_id, path)` unique to preserve current path semantics.

## Files Likely To Change

### Configuration

- `.env.example`
- `docs/setup/ENVIRONMENT.md`
- `apps/api/src/infrastructure/config.ts`
- `apps/api/src/infrastructure/config.test.ts`
- `apps/api/src/infrastructure/container.ts`

### Ports And Specs

- `apps/api/src/application/ports/outbound/SkillFileStoragePort.spec.md`
- `apps/api/src/application/ports/outbound/SkillRepositoryPort.spec.md`
- `apps/api/src/application/ports/outbound/AuditLogPort.spec.md`
- potentially a new `ContentStorageProvider.spec.md` near infrastructure

### New Adapters

- `apps/api/src/adapters/outbound/persistence/database/`
- `apps/api/src/adapters/outbound/persistence/database/database.skill-storage.ts`
- `apps/api/src/adapters/outbound/persistence/database/database.skill-repository.ts`
- `apps/api/src/adapters/outbound/audit/database/`
- optionally `apps/api/src/adapters/outbound/observability/database/`

### Database Schemas

- `apps/api/src/adapters/outbound/catalog/sqlite/sqlite.catalog-schema.ts`
- `apps/api/src/adapters/outbound/catalog/mysql/mysql.catalog-schema.ts`
- potentially new content-specific schema files if content tables should not be coupled to catalog schema setup

### Catalog Coupling

- `apps/api/src/adapters/outbound/catalog/sqlite/sqlite.skill-catalog.ts`
- `apps/api/src/adapters/outbound/catalog/mysql/mysql.skill-catalog.ts`

These adapters currently read `.meta.json` from the filesystem for version timestamps. In database mode, version/file metadata must come from relational records only.

### Use Cases To Regression-Test

- `apps/api/src/application/usecases/skill/create-skill.usecase.ts`
- `apps/api/src/application/usecases/skill/update-skill.usecase.ts`
- `apps/api/src/application/usecases/skill/review-skill.usecase.ts`
- `apps/api/src/application/usecases/skill/reindex-skill-search.usecase.ts`
- `apps/api/src/application/usecases/proposal/submit-proposal.usecase.ts`
- `apps/api/src/application/usecases/proposal/review-proposal.usecase.ts`
- `apps/api/src/application/usecases/projection/rebuild-projections.usecase.ts`
- judgement, extraction, and probe use cases that depend on `SkillFileStoragePort`

The use cases should not need storage-specific branching if the ports are implemented correctly.

### HTTP And Download Paths

- `apps/api/src/adapters/inbound/http/skill-read.controller.ts`
- `apps/api/src/adapters/inbound/http/proposal.controller.ts`
- `apps/api/src/adapters/inbound/http/admin-skill.controller.ts`
- `apps/api/src/adapters/inbound/http/admin-proposal.controller.ts`

These should remain mostly unchanged, but package downloads, proposal uploads, and file reads must be explicitly covered by database-mode tests.

### Scripts And Operations

- `scripts/check-provider-matrix.ts`
- `scripts/check-provider-cutover.ts`
- `scripts/check-backup-restore.ts`
- `scripts/full-check.sh`
- `scripts/backup.sh`
- `scripts/restore.sh`
- `scripts/start-mysql-stack.sh`
- `scripts/restart-all.sh`

Backup/restore semantics need special attention because `DATA_DIR` backup alone is no longer sufficient for MySQL database-backed content.

### Documentation

- `docs/architecture/SYSTEM_OVERVIEW.md`
- `docs/setup/ENVIRONMENT.md`
- `docs/setup/DEPLOYMENT.md`
- `docs/setup/BACKUP_AND_RESTORE.md`
- `docs/product/AGENT_OPERATIONS.md`
- `docs/decisions/ADR-005-filebased-storage.md`
- `docs/decisions/ADR-013-sqlite-metadata-truth.md`
- new ADR: database-backed content storage

## Implementation Plan

### Phase 1: Contract And Configuration

1. Add `CONTENT_STORAGE_PROVIDER=filesystem|database` parsing and validation.
2. Add config tests for defaults, valid values, invalid values, and database prerequisites.
3. Document the setting in `.env.example` and `docs/setup/ENVIRONMENT.md`.
4. Add a co-located spec for content storage provider selection.

### Phase 2: Database File Storage Adapter

1. Implement database-backed `SkillFileStoragePort`.
2. Store raw content, metadata, and extracted text in relational tables.
3. Preserve current SHA-256, MIME type, path normalization, file listing, and missing-file behavior.
4. Add adapter contract tests for both SQLite and MySQL where feasible.

### Phase 3: Database Repository Adapter

1. Implement database-backed `SkillRepositoryPort`.
2. Persist and rehydrate `Skill` and `Proposal` aggregates without YAML files.
3. Preserve proposal state transitions, judgement rehydration, content digests, latest published version behavior, and deletion semantics.
4. Keep catalog projection updates idempotent.

### Phase 4: Audit And Observability Storage

1. Implement database-backed `AuditLogPort` or extend catalog audit tables to serve as the durable audit source.
2. Keep observability snapshots out of EPIC-009 content scope; they remain operational telemetry and may stay file-backed.
3. Ensure audit export/admin views behave identically in filesystem and database modes.

### Phase 5: Migration And Cutover

1. Add a deterministic migration command such as `scripts/migrate-content-to-database.ts`.
2. Migration must copy skills, proposals, files, extracts, audit entries, and metadata from filesystem mode into database mode.
3. Migration must be idempotent and produce a JSON proof report.
4. Add rollback guidance: keep filesystem data untouched until validation passes.
5. Add integrity checks comparing filesystem source and database target.

### Phase 6: Backup/Restore And Deployment

1. Update backup docs for filesystem, SQLite database-content, and MySQL database-content modes.
2. Make `scripts/backup.sh` fail fast in MySQL database-content mode with explicit instructions that a database dump is required; add a dedicated MySQL backup script only after dump/restore semantics are implemented and tested.
3. Update deployment docs so server users know when `DATA_DIR` remains required only for logs, SQLite files, backups, or temporary work.

### Phase 7: Deterministic Proofs

1. Extend provider matrix to include content storage modes.
2. Add a content-storage matrix proof: `scripts/check-content-storage-matrix.ts`.
3. Prove proposal submit, upload, finalize, admin convert, publish, package download, extracted content, reindex, projection rebuild, and backup behavior in both `filesystem` and `database` modes.
4. Add MySQL full-gate coverage through `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh`.

## Risk Assessment

### High Risk

- Partial migration risk: file blobs, YAML aggregate state, extracts, audit, and catalog/search projections can drift if only one layer is migrated.
- Backup misconception: operators may believe `data/backups/*.tar.gz` is still sufficient in MySQL database-content mode.
- Large blob performance: storing larger artifacts in MySQL can increase DB size, backup duration, memory pressure, and query latency if downloads are not streamed or bounded.
- Transaction boundaries: aggregate state, file blobs, catalog projection, search indexing, and audit writes are currently separate operations. Database mode may make partial writes more visible unless transaction strategy is explicit.
- Catalog/file metadata coupling: current `.meta.json` reads in catalog adapters are incompatible with strict database-only content mode.

### Medium Risk

- SQLite local mode: SQLite blob storage is useful for deterministic tests, but can create large local database files and locking contention.
- MySQL packet limits: large uploads may hit `max_allowed_packet` or timeout settings unless documented and tested.
- Memory usage: current APIs often use `Buffer` in memory. This is acceptable for current upload limits but may need streaming later.
- Operational visibility: moving audit into DB changes how admins inspect incidents on a broken system; observability snapshots remain file-backed telemetry in this epic.
- Developer expectations: the repo currently contains readable `data/skills/**` fixtures. Database mode makes manual inspection harder.

### Low Risk

- Public API shape should remain stable if ports are respected.
- Frontend changes should be minimal because storage mode is backend-internal.
- Agent behavior should remain unchanged except for improved consistency.

## Things Easy To Miss

- The requirement says "all content in the database". That includes more than downloaded skill files: proposal files, extracted text, YAML aggregate state, and audit history. Observability snapshots are operational telemetry, not managed content for this epic.
- `DATA_DIR` may still be needed even in database mode for SQLite files, temporary files, proof artifacts, logs, or backups. Documentation must avoid implying the filesystem disappears completely.
- Existing bootstrap/reference skills under `data/skills/` need a defined import story for database mode.
- Rebuild and reindex flows must not depend on scanning `data/skills/` when database mode is active.
- Package download tests must prove that ZIP/direct downloads are byte-stable across storage providers.
- Public-release hygiene should ensure no DB dumps or migrated private artifacts are accidentally committed.

## Acceptance Criteria

- Filesystem and database modes are black-box equivalent for public API, admin API, frontend-visible behavior, agent-facing contracts, downloaded bytes, hashes, content digests, artifact IDs, proposal lifecycle results, audit visibility, rebuild, and reindex behavior.
- `CONTENT_STORAGE_PROVIDER` is documented, parsed, validated, and present in `.env.example`. *(Implemented for filesystem, SQLite database-content, and MySQL database-content modes.)*
- Filesystem mode remains the default and remains backward-compatible.
- Database mode can run locally with SQLite-backed content storage. *(Implemented.)*
- Database mode can run with MySQL through the existing Docker stack. *(Implemented and covered by `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh`.)*
- Skill files, proposal files, extracts, aggregate state, audit entries, and package downloads work without reading `data/skills/` or `data/proposals/`.
- Projection rebuild and search reindex work in database mode.
- Migration from filesystem mode to database mode is deterministic and idempotent. *(Implemented as copy-only migration with proof coverage for skill/proposal content and global audit entries.)*
- Database-to-filesystem export is deterministic and refuses unsafe target directories. *(Implemented through `scripts/export-content-filesystem.ts` and `scripts/check-content-export.ts`.)*
- Backup/restore documentation and scripts clearly distinguish filesystem, SQLite database, and MySQL database content modes. *(Implemented; MySQL database-content mode fails fast for `DATA_DIR`-only backup.)*
- `./scripts/check.sh` covers filesystem mode plus SQLite database-content mode without Docker. *(Implemented through `scripts/check-content-storage-matrix.ts`.)*
- `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh` covers MySQL database-content mode. *(Implemented through `CONTENT_STORAGE_MATRIX_INCLUDE_MYSQL=true`.)*
- Relevant specs, setup docs, progress docs, and OpenAPI-adjacent agent guidance are updated.

## Open Questions

- Revisit later whether `CONTENT_DATABASE_PROVIDER=sqlite|mysql` is needed for mixed deployments. The first implementation should let `CONTENT_STORAGE_PROVIDER=database` follow `CATALOG_PROVIDER`.
- Should observability later get its own `OBSERVABILITY_PROVIDER=file|database`? For EPIC-009, observability snapshots are treated as operational telemetry and may remain file-backed.
- Which future threshold should trigger object storage instead of DB BLOBs? The first implementation should keep current upload limits and preserve the port boundary for object storage later.
