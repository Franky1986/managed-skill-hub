# ADR-005: File-Based Source Of Truth

## Status

Accepted, qualified by [ADR-014](./ADR-014-database-backed-content-storage.md) for `CONTENT_STORAGE_PROVIDER=database` deployments

## Context

For the MVP, the project should start without additional infrastructure such as
PostgreSQL, S3, or OpenSearch. At the same time, skills naturally map to folders
with Markdown, YAML, and files.

## Decision

- Skills, files, and audit log are primarily stored on the filesystem under
  `data/`.
- `data/skills/` is the source of truth.
- `data/index/` contains a SQLite FTS5 search index.
- `data/audit/` contains append-only JSONL logs.
- `data/uploads/` contains temporary or additional uploads.
- `data/backups/` contains timestamped backups.
- Storage and search are encapsulated behind ports so they can later move to
  PostgreSQL/S3/OpenSearch.

## Consequences

- Very fast start, no database installation.
- Simple backups by tar/rsync of the `data/` folder.
- Atomic writes must be ensured through temp-file plus rename.
- Concurrent writes and very large files can cause problems.
- Later migration to DB/S3 is planned and supported by ports.
