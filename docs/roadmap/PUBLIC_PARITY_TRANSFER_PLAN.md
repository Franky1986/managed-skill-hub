# Public Parity Transfer Plan

This branch implements the public-safe transfer of judgement reuse, bounded
judgement concurrency, migration policy, persistence fixes, and proposal
artifact UI behavior. It deliberately excludes private provider adapters,
deployment targets, and environment-specific operational material.

## Implemented public contract

- Judger calls use canonical global and file inputs. Fingerprints and prompt
  versions are persisted through filesystem, database-content, SQLite, and
  MySQL catalog paths. A matching real judgement is cloned on proposal
  conversion; legacy judgements without this metadata are intentionally judged
  once.
- `JUDGER_MAX_CONCURRENCY` bounds all calls through one API-process judger
  instance. `JUDGER_REUSE_SCOPE` is optional; its default derives from the
  provider, selected model or adapter path, and `JUDGER_POLICY_REVISION`.
- Catalog migrations are public-native, append-only files under
  `apps/api/src/infrastructure/migrations/`. The legacy baseline is frozen
  before the reusable-judgement columns. SQLite uses an immediate lock and
  MySQL uses an advisory lock. A catalog backup is made only for pending
  changes to an existing catalog, while that lock is held.
- Proposal artifacts remain visible, proposal-backed, and read-only while an
  administrator edits proposal metadata. Repository-owned root `skill.yaml`
  is never treated as a user skill artifact.

## Deliberate exclusions

This transfer does not add provider-specific transports, credentials, host
names, aliases, runner details, deployment targets, internal documentation, or
environment-specific settings. Public custom providers remain integrations of
the documented `SkillJudgerPort` adapter boundary.
