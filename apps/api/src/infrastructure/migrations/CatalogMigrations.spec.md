# Catalog Migrations

Catalog migrations are append-only, ordered, and recorded only after their `up`
operation succeeds. The immutable legacy baseline intentionally creates the
schema that predated this migration system; later additions remain separate.

Startup and staged deployment run pending migrations before service cutover.
SQLite holds an immediate transaction lock; MySQL holds an advisory lock. While
that lock is held, an existing catalog with pending changes is backed up exactly
once. Fresh and already-current stores do not create a migration backup.
