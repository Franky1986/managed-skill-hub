# ADR-001: Architecture And Technical Stack

## Status

Accepted

## Context

We need a self-hosted skill registry for AI agents. Product managers and
developers should be able to manage, version, and approve skills. Agents should
be able to discover and load skills autonomously.

## Decision

- Hexagonal Architecture plus Domain-Driven Design.
- TypeScript backend with Fastify.
- React frontend with TypeScript.
- OpenAPI as the central contract layer.
- File-based source of truth in `data/skills/`.
- SQLite FTS5 as the search index in `data/index/`.
- Admin path through authentik/OIDC later; public read path without auth.

## Consequences

- Very fast MVP start without additional infrastructure.
- Simpler backups because all data lives on the filesystem.
- Storage and search remain replaceable because they are encapsulated behind
  ports.
- File-based storage has limits for concurrency and very large files; a later
  move to PostgreSQL/S3/OpenSearch remains possible.
- An unauthenticated read path is acceptable only inside the internal network.

## Open Points

- The exact status state machine still needs to be formalized in the domain
  model.
- A later move to PostgreSQL/OpenSearch must be documented when it becomes
  concrete.
