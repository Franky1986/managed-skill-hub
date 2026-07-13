# Spec: AdminObservabilityController (HTTP Adapter)

## Purpose

Provides admin reads for current registry observability data, including
counters, area summaries, trend/histogram data, hourly rollups, and recent error
requests.

## Scope

- `GET /admin/observability/metrics`
- `GET /admin/observability/metrics/export`

## Non-Scope

- External monitoring backends
- Authentication itself

## Responsibilities

- Enforce admin auth.
- Return current observability snapshot.
- Make current observability snapshot exportable as file.
- Do not pull business logic into HTTP layer.

## Inputs / Outputs

- Inputs: authenticated admin request
- Outputs: `ObservabilityMetricsResponse`

## Dependencies

- `ReadObservabilityUseCase`
- `SimpleAdminAuth`

## Failure Modes

- Not logged in -> `401`

## Acceptance Criteria

- Admin can read counters, area summaries, trend/histogram data, hourly rollups,
  latest requests, and latest errors.
- Admin can export the same snapshot as `json` or `csv`.
- Response matches OpenAPI spec.

## Tests / Checks

- Typecheck
- `./scripts/check.sh`
