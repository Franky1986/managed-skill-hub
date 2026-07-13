# ADR-008: Search Strategy

## Status

Accepted

## Context

Skills should be easy to find quickly, both for humans and agents.

## Decision

- MVP search is based on SQLite FTS5 with BM25 ranking.
- Regex search is possible across full skill content: manifest, description,
  and extracted text.
- Group filtering is supported.
- Later, the search port can be replaced with OpenSearch/ParadeDB.

## Consequences

- Good relevance through BM25 without additional infrastructure.
- Regex must be protected with a timeout.
- Fulltext extraction from different file types is required.
