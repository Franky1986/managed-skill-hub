# Agent Auth Matrix Check Script Spec

## Purpose

`scripts/check-agent-auth-matrix.ts` provides a deterministic, agent-readable proof
that the static bearer authentication contract behaves correctly for every
`PUBLIC_READ_AUTH_MODE`, `PROPOSAL_AUTH_MODE`, and `DISCOVERY_AUTH_MODE`
`none`/`bearer` permutation.

The script complements the Vitest suite by producing stable log and JSON artifacts
that can be attached to validation runs or inspected by another agent without
re-running the full test suite.

## Scope

The script must validate all eight permutations across:

- `/discover` visibility, auth flags, and setup-script URL presence.
- `/howToPropose` first-step behavior and auth setup metadata.
- Public-read route protection through `/categories`.
- Proposal route protection through `/proposals/notice`.
- Generated setup script fields for read/proposal tokens.

The script uses in-memory Fastify injection only. It must not start network
listeners, use real databases, read local secrets, or depend on external services.

## Outputs

A successful run writes:

- `.tmp/agent-auth-matrix.log`: compact stable line-based summary.
- `.tmp/agent-auth-matrix.json`: structured full report for machine checks.

A successful run must include:

```text
agent-api-auth-matrix
totalPermutations=8
passedPermutations=8
failedPermutations=0
RESULT=PASS
```

## Failure Behavior

Any mismatch throws an assertion error and exits non-zero. `scripts/check.sh`
runs this script after the normal test suite and reports the corresponding log
paths on failure.
