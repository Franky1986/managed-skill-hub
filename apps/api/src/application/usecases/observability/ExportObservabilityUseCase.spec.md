# Spec: ExportObservabilityUseCase (Application)

## Purpose

Exports the current observability snapshot for admins as JSON or CSV artifact so
diagnostic data can be reused outside the portal.

## Scope

- `execute(format)`

## Non-Scope

- Long-term archiving or trend aggregation over multiple snapshots
- External monitoring backends
- Authentication or HTTP file transfer itself

## Responsibilities

- Read current observability snapshot through the port.
- Serialize snapshot as JSON or CSV.
- Provide filename and `contentType` for the HTTP adapter.
- Include counters, area summaries, latest requests, and latest errors in the
  export.

## Inputs / Outputs

- Inputs: optional export format `json | csv`
- Output: `body`, `contentType`, `fileName`

## Dependencies

- `ObservabilityPort`

## Failure Modes

- Port error -> pass through error
- Unknown format -> constrain to allowed values outside the use case

## Acceptance Criteria

- JSON export matches the admin snapshot read contract.
- CSV export contains at least counter, area summary, request, and error
  sections.
- Export is read-only and does not change metric data.

## Tests / Checks

- Use-case tests for JSON and CSV export
- `./scripts/check.sh`
