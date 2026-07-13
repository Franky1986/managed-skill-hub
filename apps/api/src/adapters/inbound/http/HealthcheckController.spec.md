# Spec: HealthcheckController (HTTP Adapter)

## Purpose

Provides endpoints to inspect API health.

## Scope

- `GET /api/health`
- `GET /api/health/live`
- `GET /api/health/ready`

## Non-Scope

- Deep system diagnostics
- Protected metrics

## Responsibilities

- Return API liveness.
- Check readiness: storage and search reachable.

## Inputs / Outputs

- Inputs: HTTP GET
- Outputs: JSON `{ status, version, timestamp }` or 503

## Dependencies

- `SkillRepositoryPort` for ready check
- `SkillSearchPort` for ready check

## Failure Modes

- Storage unreachable -> 503
- Search index missing -> 503

## Acceptance Criteria

- `/api/health` returns 200 as long as the API is running.
- `/api/health/ready` checks storage and search.
- Used for deployment healthchecks.

## Tests / Checks

- HTTP integration tests

## Agent Guardrails

- No business logic in controller.
