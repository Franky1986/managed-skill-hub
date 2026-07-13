# ADR-014: Configurable Database-Backed Content Storage

## Status

Accepted

## Context

ADR-005 and ADR-013 established the filesystem under `DATA_DIR` as the physical store for managed skill artifacts, proposal uploads, aggregate YAML files, extracts, and audit JSONL files. EPIC-006 introduced MySQL as an optional relational provider for catalog and search projections, but managed content still depended on local filesystem durability.

For server deployments, especially MySQL-backed deployments, operators need an option where managed registry content is stored in the configured database so relational state and original artifacts do not drift across different durability tiers.

## Decision

- Add `CONTENT_STORAGE_PROVIDER=filesystem|database` as the physical storage selector for managed skill/proposal content.
- Keep `filesystem` as the default and backward-compatible local mode.
- In first-stage `database` mode, content storage follows `CATALOG_PROVIDER` rather than adding a separate `CONTENT_DATABASE_PROVIDER`.
- Database mode stores skill files, proposal files, extracted content, skill aggregate state, proposal aggregate state, and audit entries in database-backed adapters.
- Observability snapshots are operational telemetry, not managed registry content, and remain file-backed for this decision.
- Domain objects and use cases remain storage-provider-neutral through `SkillRepositoryPort`, `SkillFileStoragePort`, and `AuditLogPort`.
- Public APIs, admin APIs, frontend behavior, OpenAPI contracts, agent guidance, package downloads, content digests, artifact IDs, and proposal lifecycle semantics must not change by storage provider.
- Provide copy-only filesystem-to-database migration and database-to-filesystem export commands.
- `scripts/backup.sh` must fail fast for `CONTENT_STORAGE_PROVIDER=database` with `CATALOG_PROVIDER=mysql`, because a `DATA_DIR` archive alone is incomplete in that mode.

## Consequences

- Local development can remain simple with filesystem storage.
- SQLite database-content mode is testable without Docker because content tables live under `DATA_DIR/index/search.db`.
- MySQL database-content mode can keep managed content in MySQL tables, but operators must pair filesystem-side operational backups with a tested MySQL dump/restore workflow.
- Database-to-filesystem export keeps database mode inspectable, reversible, and portable.
- `DATA_DIR` can still be required in database mode for SQLite files, observability snapshots, proof artifacts, logs, backups, and temporary work.
- Existing filesystem-only assumptions in ADR-005 and ADR-013 are superseded where `CONTENT_STORAGE_PROVIDER=database` is configured.
- Future object storage can be added behind the same ports without changing domain use cases or HTTP contracts.

## Validation

- `scripts/check-content-storage-matrix.ts` proves filesystem/database runtime parity for SQLite and, in the MySQL full gate, MySQL.
- `scripts/check-content-migration.ts` proves copy-only filesystem-to-database migration including global audit entries.
- `scripts/check-content-export.ts` proves database-to-filesystem export including files, extracts, proposal content, and global audit entries.
- `scripts/check-backup-restore.ts` proves filesystem backup/restore behavior and the MySQL database-content backup guard.

## Open Points

- Production-specific MySQL dump/restore automation remains deployment-policy dependent and is intentionally not inferred by this repository.
- A future `CONTENT_DATABASE_PROVIDER` may be introduced if mixed deployments need content in a different database than catalog metadata.
- A future `OBSERVABILITY_PROVIDER` may be introduced if operators want observability snapshots in database storage.
- Large artifact/object-storage thresholds should be revisited if upload limits increase materially.
