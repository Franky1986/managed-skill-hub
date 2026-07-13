# ADR-007: No Namespace, Use Groups Instead

## Status

Accepted

## Context

Skills should be categorizable without introducing a strict namespace system.

## Decision

- There is no namespace.
- Skill IDs are globally unique.
- Skills can be assigned to one or more groups.
- Groups are free-form strings, not predefined enums.
- Namespacing is later represented by hyphenated names, for example
  `frontend-angular-testing`.
- Search supports groups as a filter.

## Consequences

- Simpler data model in the MVP.
- Flexible categorization.
- Namespacing remains a convention, not a technically enforced boundary.
