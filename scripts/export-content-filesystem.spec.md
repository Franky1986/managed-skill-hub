# scripts/export-content-filesystem.ts

## Purpose

Exports EPIC-009 database-backed managed content back into the filesystem storage layout.

## Contract

- Source content is read from `CONTENT_STORAGE_PROVIDER=database` using the configured `CATALOG_PROVIDER`.
- Target content is written to `CONTENT_EXPORT_DATA_DIR` using the filesystem repository, file storage, and audit adapters.
- The command must refuse to write into the active `DATA_DIR`.
- The command must refuse to overwrite an existing target unless `CONTENT_EXPORT_OVERWRITE=true` is set.
- The source database content must not be deleted or modified.
- Exported content must include skills, all skill versions, skill files, skill extracts, proposals, proposal files, proposal extracts, and all audit entries exposed by `AuditLogPort.findAll()`.
- The command writes deterministic proof artifacts to `.tmp/export-content-filesystem.log` and `.tmp/export-content-filesystem.json`.

## Operational Use

Use this command for rollback, debugging, portability, or vendor-lock-in avoidance after running with `CONTENT_STORAGE_PROVIDER=database`.
