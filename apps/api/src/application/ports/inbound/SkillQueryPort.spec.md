# Spec: SkillQueryPort (Inbound Port)

## Purpose

Defines all read operations the application exposes to external consumers.

## Scope

- `discover()`
- `listPublishedSummaries(category?, tags?, limit?, offset?)`
- `search(query)`
- `listCategories()`
- `listTags()`
- `getSkill(id)`
- `getSkillDetail(id)`
- `getManifest(skillId, version?)`
- `listFiles(skillId, version?)`
- `getFile(skillId, version?, fileId)`
- `listVersions(skillId)`
- `getHistory(skillId)`

## Non-Scope

- Admin write operations
- Authentication

## Responsibilities

- Deliver only `published` skills.
- Deliver categories as retrieval help.
- Deliver tags as retrieval help for agents and the public UI.
- Support repeated tag filters on list/search reads and treat them as an AND
  constraint against published skill metadata.
- Treat empty category lists from SQLite as valid truth.
- Prefer small payloads: manifest before files.
- Resolve version queries correctly.
- Provide skill, version, and artifact metadata for agent sync.
- Provide skill detail reads with usage guardrails (`useWhen`,
  `doNotUseWhen`) and `entrypoint`.
- Serve summary/detail reads preferably from the SQLite metadata projection.
- Build public skill aggregates for `getSkill()` and `listPublished()` directly
  from the SQLite catalog projection when available.
- Serve search-result metadata and published version resolution for file
  downloads preferably from the SQLite catalog projection.
- Public search returns at most one result per skill. When several indexed
  published versions match, the best-ranked hit is used for scoring and the
  visible metadata is resolved to the latest published version.
- Public clients can combine search results with public version, judgement, and
  history reads to show published-version selectors, latest overall judgement
  badges, purpose summaries, and publish change notes without exposing
  unpublished versions.
- Serve published version lists as `SkillVersionSummary` preferably from the
  SQLite catalog projection.
- Serve manifest and file metadata reads for published versions preferably from
  the SQLite catalog projection.
- Serve skill history preferably from the SQLite projection while preserving the
  same public visibility rules as the repository path.
- Treat empty history results from SQLite as valid truth.

## Inputs / Outputs

- Inputs: query DTOs with optional version
- Outputs: read DTOs

## Dependencies / Ports

- `SkillRepositoryPort`
- `SkillSearchPort`
- `SkillFileStoragePort`

## Failure Modes

- Skill not found -> `NotFoundError`
- Non-public version requested -> `ForbiddenError`
- File not found -> `NotFoundError`

## Acceptance Criteria

- Every public endpoint uses only this port.
- Draft and `in_review` skills are never delivered.
- Unpublished versions are not readable even when requested explicitly.
- Public search does not show duplicate cards for multiple published versions
  of the same skill.

## Tests / Checks

- Application tests with in-memory adapters

## Agent Guardrails

- No HTTP details in use-case code.
- No direct adapter calls outside the defined ports.
