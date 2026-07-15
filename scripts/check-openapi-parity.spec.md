# OpenAPI Parity Check Script Spec

## Purpose

`scripts/check-openapi-parity.ts` validates that the OpenAPI contract remains aligned with the implemented agent-facing HTTP routes.

## Scope

The script checks public discovery, public read, proposal, and agent-session routes. It verifies:

- Expected paths and operation IDs exist.
- Runtime-protected discovery, public-read, and proposal routes document `401`.
- Agent-critical routes document usable success responses.
- The agent-session creation route has a usable structured success response and
  the retired credential setup route is absent.
- `UnauthorizedError` exposes machine-readable auth and agent-session details.

## Outputs

- `.tmp/openapi-parity.log`
- `.tmp/openapi-parity.json`

Successful runs end with `RESULT=PASS`.
