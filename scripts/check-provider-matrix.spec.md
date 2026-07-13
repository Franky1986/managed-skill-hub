# check-provider-matrix.ts Spec

## Purpose

Prove that the public, agent-facing read surface behaves consistently across configured catalog and search provider combinations.

## Scope

The default lightweight mode runs only the `sqlite/sqlite` provider case and is safe for `./scripts/check.sh`.

When `PROVIDER_MATRIX_INCLUDE_MYSQL=true` is set, the proof additionally runs:

- `mysql/mysql`
- `sqlite/mysql`
- `mysql/sqlite`

MySQL mode expects the local MySQL stack from `scripts/start-mysql-stack.sh up` or an equivalent MySQL instance configured through `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD`.

## Validated Behavior

For every selected provider case, the proof:

- Creates a deterministic draft skill with two files.
- Submits, approves, and publishes version `1.0.0`.
- Rebuilds projections with `clearProjections=true`.
- Verifies `/discover`, `/skills`, `/skills/search`, `/categories`, `/tags`, manifest, file-list, file-content, and package-download behavior.
- Compares the normalized public surface of non-baseline provider cases against the `sqlite/sqlite` baseline.
- Verifies `scripts/restart-all.sh` contains local MySQL auto-start guidance through `start-mysql-stack.sh up`.

## Artifacts

- `.tmp/provider-matrix.log`
- `.tmp/provider-matrix.json`

## Non-Goals

- Browser UI validation.
- Production database migration validation; cutover is covered by `scripts/check-provider-cutover.ts`.
- Running MySQL by default in `./scripts/check.sh`.
