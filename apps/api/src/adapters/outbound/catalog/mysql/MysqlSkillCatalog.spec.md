# Spec: MysqlSkillCatalog (Outbound Adapter)

## Purpose

Implement `SkillCatalogPort` against a relational MySQL schema while preserving
existing catalog behavior from application contracts.

## Scope

- Maintain full skill/version metadata projection for public and admin reads.
- Preserve published visibility, category, and tag lookup behavior.
- Upsert and update skill metadata atomically with `ON DUPLICATE KEY` semantics.
- Read proposal catalog rows, proposal files, and proposal judgement metadata.
- Persist and read lifecycle audit entries and proposal/skill history rows.
- Provide deterministic rebuild behavior with optional full projection clear.

## Non-Scope

- Search ranking or keyword matching.
- Filesystem storage and proposal status orchestration.
- Alternate database products besides MySQL.

## Responsibilities

- Keep relational metadata tables normalized with explicit schema lifecycle.
- Keep tag filtering query-friendly via `skill_catalog_version_tags`.
- Preserve existing projection rebuild semantics when `rebuild()` is called.
- Keep data shape compatible with `SkillCatalogPort` DTO contracts.

## Inputs / Outputs

- Inputs: catalog updates from repository aggregates, proposal aggregates,
  judgement and audit domain events.
- Outputs: skill/proposal/version/file/audit rows used by read-path use cases.

## Failure Modes

- Duplicate key conflicts or FK inconsistencies in `rebuild()`/`upsertSkill()`
  -> `StorageError` from MySQL adapter.
- MySQL unavailable or misconfigured -> startup/configured-at-boot initialization
  may fail when provider selection requires MySQL.

## Acceptance Criteria

- For catalog contract calls (`listPublishedSkillRefs`, `getSkillVersion`,
  `listLatestSkillVersions`, `listCategories`, `listTags`, proposal + history
  reads), behavior matches other catalog adapters by contract.
- `rebuild(skills, { clearProjections: true })` fully resets projections as
  required.
- Version/file metadata supports deduplicated public reads and admin file trees.
- Provider failures are surfaced as `StorageError` and do not alter filesystem
  state.

## Tests / Checks

- Unit/integration tests for:
  - upsert skill/version/file data,
  - proposal/judgement/audit reads,
  - category/tag listing behavior,
  - rebuild with and without `clearProjections`.
- Rebuild route regression via `/admin/projections/rebuild`.
- `mysql` integration test suite.

## Agent Guardrails

- No domain decisions outside application boundaries.
- No filesystem business logic inside this adapter.
