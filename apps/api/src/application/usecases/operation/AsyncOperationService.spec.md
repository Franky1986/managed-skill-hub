# Spec: AsyncOperationService

## Purpose

Move long-running proposal finalization, re-judgement, and publication work out
of the HTTP request while exposing durable, restart-safe progress.

## Contract

- Starting an operation persists a `queued` record and returns it immediately.
- A worker atomically claims the record through a renewable lease. A different
  process may only recover the work after that lease expires.
- A worker that loses its lease stops before the next side effect or terminal
  update. Lease-owner-bound progress and completion writes act as the worker's
  fencing check; a stale worker must not overwrite a new owner's operation.
- Workers renew their lease independently of provider progress, poll durable
  queued work, and execute a bounded number of local operations at a time.
  Poll and heartbeat storage failures emit a throttled safe runtime warning and
  are retried; worker polling is stopped before storage shutdown.
- A unique active-operation key makes repeated requests for the same kind and
  target idempotent until the operation reaches a terminal state.
- Progress is persisted after every phase transition and per-file extraction or
  judgement step; it includes `completed`, `total`, and `currentTarget`.
- Completion and failure are terminal. Failure messages never expose raw
  provider payloads or credentials.
- Missing publication override reasons retain their dedicated safe error code
  so the admin UI can request the audited reason.
- Worker payloads and requester identity are private implementation data; the
  admin API exposes only the documented progress projection.

## Supported Operations

- Proposal upload finalization: validation, finalization, extraction, proposal
  judgement, per-file judgement, and optional auto-publish.
- Proposal, proposal-file, and skill-version re-judgement.
- Skill-version publication.
- Administrator shortcut for proposal conversion, review submission, approval,
  and publication as one recoverable operation. When publication requires an
  override reason, a later operation for the same converted proposal resumes
  at publication and does not repeat conversion, review submission, or
  approval.

## Tests

- Persisted incremental proposal progress reaches the terminal record.
- Publication override validation is represented as a safe terminal failure.
- A retry with an override reason resumes the converted workflow without
  repeating completed transitions.
- Repeated active-operation requests resolve to the same operation record.
- A failed owner-bound progress write stops the worker before it calls the
  corresponding judgement or publication use case.
- Worker start/stop is idempotent and background failures cannot become
  unhandled promise rejections.
- HTTP routes return `202 Accepted`; admin clients poll the operation record.
