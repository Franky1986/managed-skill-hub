# MySQL Catalog Migration Proof Spec

## Purpose

Prove the Knex catalog migration cutover against a real MySQL instance.

## Contract

- Successful migrations are recorded in `knex_migrations` only after `up`.
- A failed MySQL DDL migration remains unrecorded and can be retried
  idempotently.
- The provider cutover lock serializes competing migration runners.
- Randomly named probe columns and migration rows are removed on completion.
