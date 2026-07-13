# Spec: ContentDb Transaction Boundary

## Purpose

Provide a provider-neutral SQL boundary for database-backed managed content
without leaking transaction state across concurrent requests.

## Behavior

- `execute`, `queryAll`, and `queryOne` use the current request's transaction
  connection only when called from that transaction's async context.
- Concurrent MySQL operations outside a transaction continue through the pool
  and never join another request's transaction.
- SQLite serializes operations around an active async transaction because one
  shared connection cannot isolate interleaved statements by request context.
- Nested calls to `transaction` reuse the current transaction boundary rather
  than opening a second transaction on the same connection.

## Failure Modes

- A failed transaction is rolled back and its connection/context is released.
- Waiting SQLite operations continue after either commit or rollback.
- Schema or query failures remain provider-specific storage errors at the
  adapter boundary.

## Tests

- MySQL adapter tests prove that concurrent outside work does not use the active
  transaction connection.
- SQLite adapter tests prove that outside writes wait until the active
  transaction completes.
