# Spec: MysqlSkillSearch (Outbound Adapter)

## Purpose

Implements `SkillSearchPort` with MySQL Fulltext search.

## Scope

- Fulltext search via `MATCH ... AGAINST` with keyword and fulltext modes
- Relational tag filtering (`EXISTS` join) with AND semantics
- Regex search with timeout/fallback behavior
- Fuzzy token fallback when keyword/fulltext yields no match
- Catalog update on write paths (`indexVersion`, `removeVersion`, `reindexAll`)

## Non-Scope

- Vector/semantic search
- Proposal search

## Responsibilities

- Keep MySQL projection indexed and synchronized by version.
- Normalize native `MATCH ... AGAINST` ranking so higher score means more relevant.
- Keep search result fields compatible with `SkillSearchPort`.

## Inputs / Outputs

- Inputs: search query, mode, optional category and repeated tags, search documents for reindex
- Outputs: search result list and total count

## Failure Modes

- Regex timeout -> `StorageError`
- Invalid regex syntax -> `StorageError`
- MySQL unavailable/misconfigured -> `StorageError` with setup hint
- Driver resolution failure -> `StorageError`; the shared client must resolve
  `mysql2/promise` consistently in compiled API and Node.js 20 `tsx` runs.

## Acceptance Criteria

- Public search behavior stays compatible with the provider-neutral contract.
- Repeated tag filters are enforced as AND.
- Typo-like queries such as `vido` can still match `video` documents via fuzzy fallback.
- Category filter narrows without changing scoring order.

## Tests / Checks

- Fuzzy fallback contract check (query-level behavior).
- MySQL schema bootstrap through adapter constructor.
- Reindex populates tags and documents.

## Agent Guardrails

- No search-specific logic outside the search adapter.
