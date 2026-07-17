# Agent Auth Matrix Check Script Spec

## Purpose

`scripts/checks/check-agent-auth-matrix.ts` provides a deterministic, agent-readable proof
that the static bearer authentication contract behaves correctly for every
`PUBLIC_READ_AUTH_MODE`, `PROPOSAL_AUTH_MODE`, and `DISCOVERY_AUTH_MODE`
`none`/`bearer`/`oidc` permutation.

The script complements the Vitest suite by producing stable log and JSON artifacts
that can be attached to validation runs or inspected by another agent without
re-running the full test suite.

## Scope

The script must validate all 27 permutations across:

- `/discover` visibility, auth flags, OIDC metadata, and agent-session discovery.
- `/howToPropose` first-step behavior and auth setup metadata.
- Public-read route protection through `/categories`.
- Proposal route protection through `/proposals/notice`.
- Short-lived agent-session creation, area access, and cross-area isolation for
  bearer-protected routes.
- Absence of the retired `/agent-credentials/setup.sh` route and metadata.

The script uses in-memory Fastify injection only. It must not start network
listeners, use real databases, read local secrets, or depend on external services.

## Outputs

A successful run writes:

- `.tmp/agent-auth-matrix.log`: compact stable line-based summary.
- `.tmp/agent-auth-matrix.json`: structured full report for machine checks.

A successful run must include:

```text
agent-auth-matrix
total=27
passed=27
failed=0
RESULT=PASS
```

## Failure Behavior

Any mismatch throws an assertion error and exits non-zero. `scripts/check.sh`
runs this script after the normal test suite and reports the corresponding log
paths on failure.
