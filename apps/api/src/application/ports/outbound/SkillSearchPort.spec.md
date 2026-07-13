# Spec: SkillSearchPort (Outbound Port)

## Purpose

Provides skill search functions independently of concrete search technology.

## Scope

- `search(query: SkillSearchQuery)` -> keyword/BM25
- `regexSearch(query: RegexSearchQuery)`
- `fulltextSearch(query: FulltextSearchQuery)`
- `indexSkillVersion(version: SkillVersion, extractedText)`
- `removeFromIndex(skillId, version)`
- `reindexAll()`

## Non-Scope

- Semantic/vector search in the MVP

## Responsibilities

- Fast search over title, tags, description, manifest, and extracted file text.
- Support optional category/group and repeated tag filters so public discovery
  can narrow results without reindexing or domain-layer search logic.
- Update index after every write.
- Protect regex with timeout.
- Deliver result scoring with provider-neutral semantics where higher numeric
  `score` values are more relevant.

## Inputs / Outputs

- Inputs: query DTOs, `SkillVersion` plus text
- Outputs: list of `SearchResult` DTOs

## Dependencies

- `SkillVersion`

## Failure Modes

- Index not synchronized -> `SearchOutdatedError`; reindex needed
- Regex timeout -> `ValidationError`

## Acceptance Criteria

- Search results contain only `published` skills.
- Index is consistent after every successful write.
- Reindex completes under 60 seconds for MVP data volumes.

## Tests / Checks

- Contract tests for SQLite FTS5 adapter
- MySQL adapters should normalize native ranking to the same `score` semantics before
  returning results.

## Agent Guardrails

- No search-specific logic in domain or use cases.
- No direct SQL queries outside the adapter.
