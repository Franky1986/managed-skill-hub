# Spec: FileBackedObservability (Outbound Adapter)

## Purpose

Persists the current HTTP observability snapshot locally on the filesystem so
counters, trend data, hourly rollups, and recent requests survive restarts.

## Scope

- `recordHttpRequest(observation)`
- `getSnapshot()`
- snapshot load on adapter start

## Non-Scope

- Infinite or unbounded long-term history
- External monitoring backends
- Domain logic based on metrics

## Responsibilities

- Provide the same counter and recent-request semantics as the in-memory
  adapter.
- Write current snapshot to disk best effort.
- Reload existing snapshot on start.
- Preserve rolling timeline buckets and cumulative histogram counters beyond the
  current `recentRequests` sample.
- Preserve hourly rollups across a bounded retention window.
- Encapsulate persistence errors internally so domain paths do not block.

## Inputs / Outputs

- Inputs: `HttpRequestObservation`, snapshot file path
- Outputs: `ObservabilitySnapshot`

## Failure Modes

- Broken or missing snapshot file -> adapter starts with empty state.
- Write error during persistence -> request path remains successful; snapshot
  can become stale.

## Acceptance Criteria

- Recorded requests increment counters and appear in `recentRequests`.
- Trend and histogram data remain consistent when more requests arrive than are
  kept in `recentRequests`.
- Hourly rollups survive restart and extend beyond the `recentRequests` sample.
- A snapshot persisted after `recordHttpRequest` can be loaded by a new adapter
  instance.
- Persistence errors do not throw into the calling request path.

## Tests / Checks

- Adapter tests for persistence and rehydration
- `./scripts/check.sh`
