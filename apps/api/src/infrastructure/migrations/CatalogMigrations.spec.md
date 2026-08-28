# Catalog Migrations

Catalog migrations are append-only, ordered, and recorded only after their `up`
operation succeeds. Knex owns the standard `knex_migrations` and
`knex_migrations_lock` tables; it is used only for migrations, never as a
runtime repository or query abstraction. The immutable legacy baseline
intentionally creates the schema that predated this migration system; later
additions remain separate.

On the first Knex run, IDs in the legacy
`managed_skill_hub_schema_migrations` table are imported once into
`knex_migrations`. The legacy table remains as read-only history.

Startup and staged deployment run pending migrations while the previous
release is quiesced and before service cutover.
SQLite holds an exclusive cutover lock file; MySQL holds the legacy-compatible
advisory lock. While that lock is held, an existing catalog with pending changes is backed up exactly
once. Fresh and already-current stores do not create a migration backup.

The SQLite lock records its owning process ID and process-start identity and
atomically reclaims a lock only when that owner is gone or its PID was reused;
a live owner remains fail closed. MySQL foreign-key normalization compares
columns, references, and `ON DELETE`; semantically duplicate legacy foreign
keys are removed and the frozen canonical constraint is recreated.

Catalog and identity adapters never create or alter schema. Container startup
and the migration CLI are the only production schema writers.

`2026082801_normalize_legacy_catalog` is an append-only compatibility migration
for partial legacy tables. It restores historical columns, backfills agent
session IDs and creates required indexes without calling mutable runtime schema
helpers.

`2026082802_finalize_legacy_catalog_parity` transactionally rebuilds SQLite
agent sessions to restore `session_id NOT NULL` and repairs the frozen MySQL
foreign-key set idempotently.
