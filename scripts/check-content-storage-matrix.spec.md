# Spec: check-content-storage-matrix

## Purpose

Proves that `CONTENT_STORAGE_PROVIDER` is externally invisible for the local deterministic storage modes.

## Covered Modes

- `filesystem` with SQLite catalog/search.
- `database` with SQLite catalog/search and SQLite-backed content tables.

## Responsibilities

- Create and publish the same deterministic skill fixture in each mode.
- Exercise public read endpoints through Fastify injection.
- Compare scrubbed JSON responses for list, search, detail, manifest, files, categories, tags, and history.
- Compare direct file download bytes and deterministic package download bytes.
- Verify database mode does not create managed `data/skills` or `data/proposals` content directories and writes `content.db`.

## Artifacts

- `.tmp/content-storage-matrix.log`
- `.tmp/content-storage-matrix.json`

## Acceptance Criteria

- Filesystem and database modes are black-box equivalent for the covered public API and download paths.
- Any mismatch exits non-zero and records the mismatch in the JSON artifact.
