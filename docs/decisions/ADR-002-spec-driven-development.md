# ADR-002: Spec-Driven Development With Co-Located `*.spec.md`

## Status

Accepted

## Context

The project has many non-trivial boundaries: domain entities, ports, adapters,
API endpoints, storage, and search. Without local specifications, contracts and
behavior are likely to get lost between iterations.

## Decision

Every non-trivial boundary, use case, interface, and adapter is documented as a
co-located `*.spec.md` next to the code. Specs are living documentation and must
be updated for material changes.

## Consequences

- Every change to a non-trivial boundary starts by reading the spec.
- Behavior changes require an updated spec in the same work item.
- New developers and agents find contracts faster.
- Maintenance overhead stays low when specs remain concise and focused.

## Open Points

- The check script should later verify whether changed boundaries also updated
  their specs.
