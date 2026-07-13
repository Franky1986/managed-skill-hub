# ADR-011: Skill ID Rules

## Status

Accepted

## Context

Skill IDs should be machine-readable, unique, and consistent.

## Decision

- Skill IDs are globally unique.
- Format: slug-style, only lowercase letters, numbers, and hyphens.
- Minimum length: 3 characters.
- Recommended maximum length: 64 characters.
- No leading or trailing hyphens.
- No consecutive hyphens.
- The name suggestion endpoint derives an ID from the title and checks
  uniqueness.

## Consequences

- Clear rules for agents and humans.
- Unique URLs and file paths.
- Later namespacing through hyphens is possible.
