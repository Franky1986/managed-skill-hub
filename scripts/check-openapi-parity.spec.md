# OpenAPI Parity Check Script Spec

## Purpose

`scripts/check-openapi-parity.ts` validates that the OpenAPI contract remains aligned with the implemented agent-facing HTTP routes.

## Scope

The script checks public discovery, public read, proposal, and credential setup routes. It verifies:

- Expected paths and operation IDs exist.
- Runtime-protected discovery, public-read, and proposal routes document `401`.
- Agent-critical routes document usable success responses.
- The no-secret credential setup script remains publicly downloadable.
- `UnauthorizedError` exposes machine-readable auth details used by agents.

## Outputs

- `.tmp/openapi-parity.log`
- `.tmp/openapi-parity.json`

Successful runs end with `RESULT=PASS`.
