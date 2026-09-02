# Changelog

All notable changes to ManagedSkillHub are documented here.

## [0.2.0] - 2026-09-02

### Added

- Deterministic judgement reuse for unchanged proposal and skill-version inputs
  when a stable configured model identity matches the stored fingerprint.
- Bounded judger execution, safe provider-error handling, and runtime events for
  proposal, file, and skill-version judgements.
- Knex-managed catalog migrations with SQLite and MySQL parity, migration
  locking, stale-lock recovery, legacy-schema normalization, and migration
  backup support.
- Proposal lifecycle safeguards, including rejection/invalid-conversion
  regression coverage and published-only package download proofs.
- A dedicated **Review** proposal filter with visible counts for judged and
  approved proposals.
- Durable asynchronous review operations with restart-safe progress for
  proposal finalization, re-judgement, and publication.

### Changed

- Proposal conversion now validates its domain transition before creating a
  draft skill, copying artifacts, or writing audit/catalog side effects.
- The admin workflow now shows rejection validation next to the reason field.
- Publishing a version with incomplete judgements opens an audited override
  dialog that requires a reason.
- The admin UI shows live review phase, current target, and per-file progress;
  uploads have a scoped longer transport timeout without extending judgement
  requests.
- Deployment, environment, backup, migration, and verification documentation
  now cover the supported SQLite and MySQL operational paths.

### Security

- Public-release hygiene, deterministic package-download, migration, backup,
  provider, and lifecycle verification gates were expanded.
- Only published skill versions remain available through public retrieval and
  package-download endpoints.

## [0.1.0]

- Initial ManagedSkillHub release.
