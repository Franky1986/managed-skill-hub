# Full Check Script Spec

## Purpose

`scripts/full-check.sh` is the EPIC-008 entrypoint for extended local or CI validation. It always runs the lightweight baseline check and can opt into smoke tests and Docker/MySQL-oriented gates through environment flags.

## Scope

The script runs:

- `./scripts/check.sh` unconditionally.
- `bash scripts/smoke-test.sh` when `RUN_SMOKE_TEST=true`.
- `bash scripts/start-mysql-stack.sh up` and future provider matrix/cutover scripts when `RUN_MYSQL_FULL_CHECK=true`.
- MySQL provider checks run after a clean workspace install and therefore require
  the runtime `mysql2` driver to be declared in the API workspace and lockfile.

Missing future EPIC-008 scripts are reported as planned-but-not-implemented instead of failing the implemented baseline gates.

## Outputs

- `.tmp/full-check-baseline.log`
- `.tmp/full-check-smoke.log` when smoke tests are enabled
- `.tmp/full-check-mysql-stack.log` when MySQL checks are enabled
- Additional `.tmp/full-check-*.log` files for implemented extended gates

Successful implemented-gate runs end with `[OK]`.
