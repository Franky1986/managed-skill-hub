# Spec: check-content-migration

## Purpose

Proves deterministic filesystem-to-database content migration for EPIC-009.

## Scope

- Creates an isolated filesystem-backed source registry fixture.
- Runs `scripts/migrate-content-to-database.ts` against that isolated `DATA_DIR`.
- Reopens the same registry with `CONTENT_STORAGE_PROVIDER=database`.
- Verifies migrated skill aggregate, published version, skill file bytes, proposal metadata, proposal file metadata, and skill audit entries.
- Verifies the source filesystem artifact remains in place after migration.

## Artifacts

- `.tmp/content-migration.log`
- `.tmp/content-migration.json`
- `.tmp/migrate-content-to-database.log`
- `.tmp/migrate-content-to-database.json`

## Acceptance Criteria

- Migration is copy-only and does not delete source files.
- Database mode can read the migrated managed content through application ports.
- The script exits non-zero on any missing aggregate, file, proposal, or audit evidence.
