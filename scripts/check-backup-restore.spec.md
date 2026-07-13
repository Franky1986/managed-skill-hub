# Backup And Restore Check Script Spec

## Purpose

`scripts/check-backup-restore.ts` proves that repository backup and restore
scripts can preserve deterministic skill, proposal, audit, and projection data
without touching the developer's normal `data/` directory.

## Scope

The script validates:

- `scripts/backup.sh` creates a tar.gz archive for an isolated `DATA_DIR`.
- `scripts/restore.sh` can restore that archive with `MSH_SKIP_STOP=true`.
- `scripts/restore.sh` validates archive members before restore and rejects
  absolute paths, `..` traversal, symlinks, and hardlinks.
- Existing data is moved aside into a pre-restore safety directory.
- Restored skill, proposal, audit, and projection files match the fixture data.
- MySQL database-content mode fails fast because a `DATA_DIR` archive alone is incomplete.

It uses only `.tmp/backup-restore-proof/data` as `DATA_DIR`. It must not stop
running local stacks during proof execution.

## Outputs

Successful runs write:

- `.tmp/backup-restore.log`
- `.tmp/backup-restore.json`

A successful run must include:

```text
backup-restore
totalChecks=8
passedChecks=8
failedChecks=0
RESULT=PASS
```

## Failure Behavior

Any mismatch exits non-zero. This proof is intended for `scripts/full-check.sh`
or explicit invocation because it executes shell backup/restore scripts.
