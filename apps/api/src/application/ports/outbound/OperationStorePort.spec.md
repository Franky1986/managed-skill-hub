# Spec: OperationStorePort

## Purpose

Defines durable storage and lease-based coordination for asynchronous
administrative operations across SQLite and MySQL adapters.

## Contract

- A dedupe key identifies one active logical operation while it is queued or
  running.
- Workers discover runnable work, claim it with a bounded lease, and may update
  progress only while they own that lease.
- Completion or failure clears active deduplication eligibility and records a
  safe terminal state.
- Records retain internal payload, requester, and dedupe metadata for worker
  execution; inbound adapters must redact those fields.

## Failure And Recovery

- A worker crash leaves an expired lease that another worker may claim.
- Conditional claims and owner-bound updates prevent concurrent workers from
  completing or overwriting the same operation.
