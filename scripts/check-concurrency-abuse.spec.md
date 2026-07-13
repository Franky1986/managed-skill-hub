# Concurrency And Abuse Check Script Spec

## Purpose

`scripts/check-concurrency-abuse.ts` proves that repeated proposal state
transitions and malformed package paths fail safely without corrupting state or
creating unsafe downloadable artifacts.

## Scope

The lightweight script validates:

- Repeated proposal finalization is rejected.
- Uploading files after finalization is rejected.
- Repeated proposal conversion is rejected.
- Relative artifact path normalization rejects traversal, absolute, Windows-drive,
  and UNC-style paths.
- Duplicate proposal file uploads for the same path replace the open
  `in_upload` file cleanly and leave the proposal finalizable.
- HTTP proposal file count and file size limits are enforced.
- Concurrent projection rebuilds preserve a queryable published projection.
- Skill package downloads reject unsafe adapter-provided file paths before ZIP
  creation and return the API validation-error status.

It uses in-memory domain objects and Fastify injection only. It must not start
network listeners, Docker, databases, or mutate committed fixtures.
Runtime packages are resolved through the npm workspace graph; the proof must
not assume a package exists under a specific workspace `node_modules` path.

## Outputs

Successful runs write:

- `.tmp/concurrency-abuse.log`
- `.tmp/concurrency-abuse.json`

A successful run must include:

```text
concurrency-abuse
totalChecks=10
passedChecks=10
failedChecks=0
RESULT=PASS
```

## Failure Behavior

Any mismatch exits non-zero. `scripts/check.sh` runs this script and reports
`.tmp/concurrency-abuse.check.log` plus the proof artifact path on failure.
