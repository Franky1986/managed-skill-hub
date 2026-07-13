# Backup and Restore

## Backup

A backup stores the complete `data/` directory as a `tar.gz` archive under
`data/backups/`.

```bash
bash scripts/backup.sh
```

Output:

```text
[INFO] Creating backup: data/backups/managed-skill-hub-data-20260701-120000.tar.gz
[OK] Backup created: data/backups/managed-skill-hub-data-20260701-120000.tar.gz
```

### What Is Backed Up?

- `data/skills/`
- `data/proposals/`
- `data/index/`
- `data/audit/`
- `data/uploads/`

### Backup Strategy

- The MVP does not configure automatic backups.
- Create backups manually on a regular schedule and copy them to external
  storage.
- Before a restore, the script automatically creates a safety copy of the
  current `data/` directory.

### Content Storage Modes

Backup completeness depends on `CONTENT_STORAGE_PROVIDER` and `CATALOG_PROVIDER`:

| Mode | Durable managed content location | Current backup behavior |
|------|----------------------------------|-------------------------|
| `CONTENT_STORAGE_PROVIDER=filesystem` | `DATA_DIR/skills`, `DATA_DIR/proposals`, `DATA_DIR/audit`, and index files | `scripts/backup.sh` archives `DATA_DIR` and is complete for managed content. |
| `CONTENT_STORAGE_PROVIDER=database` with `CATALOG_PROVIDER=sqlite` | SQLite database under `DATA_DIR/index/search.db` plus operational files under `DATA_DIR` | `scripts/backup.sh` archives `DATA_DIR`; this includes the SQLite content database. Stop writes before backup for a consistent archive. |
| `CONTENT_STORAGE_PROVIDER=database` with `CATALOG_PROVIDER=mysql` | MySQL content tables plus operational files under `DATA_DIR` | `scripts/backup.sh` intentionally fails fast because a `DATA_DIR` archive alone is incomplete. Use a tested MySQL dump/restore workflow until dedicated automation exists. |

EPIC-009 keeps database content storage operationally conservative: database mode includes copy-only migration, database-to-filesystem export, and backup-mode guards. Use `scripts/export-content-filesystem.ts` when a database-backed registry must be inspected, rolled back, or moved back to filesystem storage.

## Restore

```bash
bash scripts/restore.sh data/backups/managed-skill-hub-data-20260701-120000.tar.gz
```

Workflow:

1. Validate the archive and reject absolute paths, `..` traversal, symlinks, and
   hardlinks.
2. Stop the stack if it is running.
3. Move the current `data/` directory to `data.pre-restore-<timestamp>`.
4. Extract the backup to `data/`.
5. Restart the stack when ready:
   ```bash
   bash scripts/restart-server.sh
   ```

## Notes

- `scripts/restore.sh` does not delete the current `data/` directory; it moves
  it aside.
- `scripts/restore.sh` rejects unsafe tar members before moving the current
  `data/` directory.
- After a restore, check whether `data/index/` is consistent and reindex if
  needed.

## Deterministic Proof

The extended validation entrypoint runs an isolated backup/restore proof without
stopping local development servers:

```bash
./scripts/full-check.sh
```

The proof uses `MSH_SKIP_ENV=true` so root `.env` values cannot override the
isolated `DATA_DIR`, and `MSH_SKIP_STOP=true` so restore validation does not
stop local processes. These flags are intended for tests and CI; normal operator
restore should keep the default stop behavior.
