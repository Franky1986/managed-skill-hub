# Environment Layout Migration Specification

## Purpose

Migrate an existing root `.env` to the layered configuration model without
printing or losing secret values.

## Behavior

- `--check` reports only secret key names that must move and non-secret keys
  missing from `.env`; it never reports values.
- `--write` moves keys ending in `_PASSWORD`, `_PASSWORD_HASH`, `_SECRET`,
  `_TOKEN`, or `_API_KEY` from `.env` to `.env.secrets`.
- Existing non-empty secret values are preserved. Conflicting non-empty values
  fail closed without displaying either value.
- Missing non-secret assignments are appended from `.env.example` without
  replacing existing local values.
- Writes are atomic, both local files receive mode `0600`, and symbolic-link
  targets are rejected.
- `.env.secrets.example` initializes a missing secret file.

## Commands

```bash
./node_modules/.bin/tsx scripts/migrate-env-layout.ts --check
./node_modules/.bin/tsx scripts/migrate-env-layout.ts --write
```
