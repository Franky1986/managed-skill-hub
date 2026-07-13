# Spec: RebuildProjectionsUseCase

## Purpose

Provide an operational use case that rebuilds relational/file-based search projections
from primary sources without depending on existing projection state.

## Scope

- Rebuild catalog projection for published and non-published data from filesystem
  artifacts and catalog-eligible YAML sources.
- Rebuild proposal projection (skills, proposals, files, and proposal judgements).
- Rebuild skill/file/version judgements from authoritative audit primary events.
- Rebuild audit projection from all skill/proposal audit primaries.
- Rebuild search documents from published versions and extracted artifacts.
- Emit an audit trail entry for the rebuild action.

## Non-Scope

- Replacing manual data cleanup operations outside `/admin/projections/rebuild`.
- Introducing new storage engines.
- Converting proposal/skill content.

## Responsibilities

- Keep filesystem as the primary source for skill/proposal shape and files.
- Keep audit entries as a primary source for skill/file judgement history reconstruction.
- Rebuild catalog in two modes:
  - `clearProjections: false` (default): refresh skill/version and file rows.
  - `clearProjections: true`: full reset including proposals, judgements and audit rows.
- Rebuild search index consistently from all published versions.

## Inputs / Outputs

- Inputs: actor id (string), repository, catalog, audit log, storage, scanner, search.
- Outputs: summary counts and whether reconstruction was attempted.

## Failure Modes

- Repository reads fail -> propagate a storage error.
- Scanner failures for individual files -> do not fail the whole rebuild; skip file text.
- Malformed audit entries -> skip reconstructing judgement while still storing audit history.

## Acceptance Criteria

- `/admin/projections/rebuild` can recover projections from clean DBs using
  existing `data/` and `audit/` primaries.
- Rebuilt catalog rows are internally consistent with projections read by public/admin
  read paths.
- Search index contains all published versions and is compatible with public search flows.
