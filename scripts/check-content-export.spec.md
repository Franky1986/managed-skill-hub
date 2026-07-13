# scripts/check-content-export.ts

## Purpose

Proves deterministic database-to-filesystem content export for EPIC-009.

## Covered Behavior

- Creates source content directly in `CONTENT_STORAGE_PROVIDER=database` mode.
- Verifies the database source does not create managed `data/skills` content.
- Runs `scripts/export-content-filesystem.ts` into a separate target data directory.
- Reopens the exported target in `CONTENT_STORAGE_PROVIDER=filesystem` mode.
- Verifies skill aggregate state, published version state, nested skill files, skill extracts, proposal aggregate state, proposal files, proposal extracts, skill audit entries, and global audit entries.
- Writes `.tmp/content-export.log` and `.tmp/content-export.json` proof artifacts.
