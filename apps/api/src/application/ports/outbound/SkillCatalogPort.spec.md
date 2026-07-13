# Spec: SkillCatalogPort (Outbound Port)

## Purpose

Provides a relational metadata projection for skills, versions, categories,
and files.

## Scope

- Project skill metadata to the configured catalog provider.
- Read categories from the catalog projection.
- Read published skill references from the catalog projection.
- Read exact skill versions from the catalog projection.
- Read published versions and file metadata from the catalog projection.
- Read proposal metadata, proposal files, proposal judgements, and review-pending
  proposal counts.
- Trigger full projection rebuild from existing skills.

## Non-Scope

- Delivering file contents themselves
- Fulltext search and BM25 ranking

## Responsibilities

- Build the configured catalog projection as canonical retrieval-near
  skill/version/file information.
- Make categories and published visibility derivable without YAML rehydration.
- Allow exact version resolution for search hits and file downloads without
  repository rehydration.
- Keep file metadata for viewer and agent sync.

## Inputs / Outputs

- Inputs: `Skill` aggregates
- Outputs: category lists, published skill/version/file references

## Dependencies

- Configured catalog store:
  - sqlite: `data/index/`
  - mysql: configured `MYSQL_DATABASE` schema
- Skill file metadata under `data/skills/**/.meta.json`

## Failure Modes

- Projection backend not writable -> `StorageError`
- Skill file metadata missing -> reduced file metadata, but projection remains
  runnable

## Acceptance Criteria

- After successful write or rebuild, published categories and published skill
  references are readable from the configured catalog provider.
- File metadata contains at least path, role, MIME type, size, checksum, and
  `artifactId`.
- Pending proposal counts include finalized review states such as `submitted`
  and `judged`, but exclude `in_upload` because that state is still controlled by
  the submitting agent/client.

## Tests / Checks

- Adapter tests against both sqlite and mysql catalog implementations where provider coverage is available.

## Agent Guardrails

- No business logic in the adapter except projection and read metadata queries.
