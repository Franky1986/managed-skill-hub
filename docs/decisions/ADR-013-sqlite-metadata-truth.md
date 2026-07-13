# ADR-013: SQLite As Domain Metadata Truth

## Status

Accepted, qualified by [ADR-014](./ADR-014-database-backed-content-storage.md) for `CONTENT_STORAGE_PROVIDER=database` deployments

## Context

ADR-005 defined the filesystem (`data/skills/`) as the source of truth for
skills, files, and audit data in the MVP. During EPIC-002 it became clear that
many read paths, visibility decisions, and review queries can be served more
efficiently and consistently from a projected metadata layer instead of
rehydrating the complete skill repository from YAML files on every request.

## Decision

- The filesystem remains the physical storage for original skill files,
  proposal uploads, and audit logs.
- SQLite becomes the **domain metadata truth** for:
  - skills and skill versions, including `skillUuid`, `versionUuid`,
    `contentDigest`, status, and timestamps
  - file metadata, including `artifactId`, `sha256`, `sizeBytes`, `mimeType`,
    `updatedAt`, and `extractable`
  - categories
  - proposal metadata
  - review/judgement data
  - skill audit history
  - search index (FTS5)
- Write operations materialize state in the filesystem first using atomic
  writes and then mirror it into the SQLite projection.
- Read paths prefer the SQLite projection and only fall back to the filesystem
  for missing projections or raw file/blob contents.
- Empty results from the SQLite projection are valid answers; fallback to
  filesystem rehydration happens only when the projection is incomplete or
  inconsistent.

## Consequences

- Significantly faster and more consistent read paths for UI and agents.
- Simpler queries for categories, versions, status, and reviews.
- The filesystem remains the human-readable, version-control-friendly artifact
  store.
- Backup and restore processes must continue to back up `data/` as a whole,
  including SQLite files and filesystem artifacts together.
- Divergence between SQLite projection and filesystem is a critical
  inconsistency and must be repairable through reindex/rebuild.
- Storage, search, and audit ports remain replaceable; the SQLite
  implementation is an adapter, not a fixed architecture dependency.
- Operationally, skill changes must always check whether only artifacts or also
  the domain projection are affected. Removing or changing files under
  `data/skills/` alone is not sufficient if SQLite and search index entries
  still deliver the skill.
- Especially for deletion, replacement, renaming, or structural file changes,
  filesystem and SQLite projection must be considered together.

## Open Points

- Long term, filesystem dependency for metadata can be reduced further once
  migration tests for PostgreSQL/S3 exist.
- An automatic integrity check between SQLite and filesystem is desirable for
  operational hardening.
