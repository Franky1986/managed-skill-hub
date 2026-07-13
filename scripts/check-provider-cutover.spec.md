# Provider Cutover Proof Script Spec

## Context

EPIC-008 requires deterministic proof that an operator can move a local SQLite-backed ManagedSkillHub deployment to MySQL providers and still preserve the public agent contract.

## Script

- Path: `scripts/check-provider-cutover.ts`
- Execution: explicit local invocation or `RUN_MYSQL_FULL_CHECK=true ./scripts/full-check.sh`
- Infrastructure: local MySQL stack from `scripts/start-mysql-stack.sh up`

## Fixture

The script uses a fresh isolated `DATA_DIR` under `.tmp/provider-cutover-data` and stable fixture IDs:

- `provider-cutover-baseline-skill`
- `provider-cutover-new-write-skill`
- one finalized proposal fixture

No committed `data/` fixtures are mutated.

## Flow

1. Start with `sqlite/sqlite` providers, publish the baseline skill, create and finalize a proposal, rebuild projections with `clearProjections=true`, and capture the public API baseline.
2. Write backup evidence to `.tmp/provider-cutover-backup-evidence.json` before switching providers.
3. Rebuild the same `DATA_DIR` with `mysql/mysql` providers and compare public API parity against the SQLite baseline.
4. Create and publish an additional skill through the MySQL-backed providers, rebuild projections, and verify the new write is public and searchable.
5. Switch back to `sqlite/sqlite`, rebuild projections, and compare the rollback public API surface against the MySQL post-write surface.
6. Assert `scripts/restart-all.sh` contains the MySQL auto-start/preflight path so the operator does not need a separate manual MySQL start step.

## Assertions

The script validates:

- published skills are visible through `GET /skills`;
- published skills are searchable through `GET /skills/search`;
- categories and tags survive cutover;
- explicit manifest version resolution works;
- versioned file listing and file download work;
- versioned package download returns deterministic safe ZIP entries;
- proposal projection count survives rebuilds;
- new writes after MySQL cutover survive SQLite rollback;
- restart guidance starts the local MySQL stack automatically.

## Artifacts

The script writes:

- `.tmp/provider-cutover.log`
- `.tmp/provider-cutover.json`
- `.tmp/provider-cutover-backup-evidence.json`
- `.tmp/provider-cutover-mismatch-*.json` only on parity failure

## Safety

The proof does not require secrets or paid services. It uses `JUDGER_PROVIDER=noop` and isolated temporary data. It requires the local MySQL test stack and is therefore not part of the default lightweight `./scripts/check.sh` execution.
