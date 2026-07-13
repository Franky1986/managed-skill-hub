# Spec: SqliteSkillSearch (Outbound Adapter)

## Purpose

Implements `SkillSearchPort` with SQLite FTS5.

## Scope

- Fulltext search with BM25
- Fuzzy token fallback when FTS returns no result for a likely typo
- Regex search with timeout
- Index update after writes
- Reindex operation

## Non-Scope

- Vector/semantic search

## Responsibilities

- Index manifest and extracted text.
- Return search results with score and snippet.
- Protect regex queries with timeout.

## Inputs / Outputs

- Inputs: `SkillSearchQuery`, `RegexSearchQuery`, `SkillVersion` plus text
- Outputs: `SearchResult[]`

## Dependencies

- `data/index/search.db`
- `better-sqlite3` or similar Node SQLite module

## Failure Modes

- Regex timeout -> `ValidationError`
- Index not synchronized -> incomplete search results; reindex needed
- SQLite not writable -> `StorageError`

## Acceptance Criteria

- Search results contain only `published` skills.
- BM25 ranking returns relevant results.
- Typo-like queries such as `vido` can still find indexed `video` content via
  fuzzy fallback.
- Reindex completes under 60 seconds for MVP data volumes.

## Tests / Checks

- Contract tests
- Regex timeout tests

## Agent Guardrails

- No SQLite-specific logic outside this adapter.
- Always execute regex with timeout.
