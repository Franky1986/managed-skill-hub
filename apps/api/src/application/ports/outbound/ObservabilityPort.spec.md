# Spec: ObservabilityPort

## Purpose

Provides a lightweight observability boundary for HTTP-related structured
metrics and recent request traces.

## Scope

- Count HTTP requests with domain area, duration, and status.
- Provide area summaries for latency and error rate.
- Provide trend data over recent request windows.
- Provide latency histogram over recent request samples.
- Provide hourly rollups for longer-term retention.
- Make latest requests and latest errors readable for admin diagnostics.
- Provide snapshots for admin reads.

## Non-Scope

- Unlimited long-term metrics
- External monitoring backends
- Business decisions based on metrics

## Responsibilities

- Classify requests into domain areas such as `retrieval`, `proposal`,
  `review`, `publish`, `extraction`.
- Provide structured counter snapshots.
- Derive area summaries for request count, error count, and latency.
- Derive trend buckets for recent windows from request samples.
- Derive latency histogram over predefined duration classes.
- Derive or provide hourly rollups over a bounded retention window.
- Keep latest requests readable including `traceId` and relevant skill/file IDs.
- Make recent error requests visible separately.

## Inputs / Outputs

- Inputs: `HttpRequestObservation`
- Outputs: `ObservabilitySnapshot`

## Failure Modes

- Observability failure must not block domain operations.
- Missing optional IDs are treated as `null`/absent.

## Acceptance Criteria

- A request increments the matching counter.
- A snapshot contains counters, area summaries, trend buckets, latency
  histogram, hourly rollups, recent requests, and recent errors.
- `traceId` matches the HTTP request context.

## Tests / Checks

- Adapter tests for counter and request snapshot behavior
- `./scripts/check.sh`
