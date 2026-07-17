# Proposal Lifecycle Check Script Spec

## Purpose

`scripts/checks/check-proposal-lifecycle.ts` proves the deterministic agent proposal workflow against real Fastify routes and an isolated SQLite-backed `DATA_DIR`.
Runtime packages are resolved through the npm workspace graph rather than a
hard-coded workspace `node_modules` path.

## Scope

The script validates `/howToPropose`, deterministic similar duplicate candidates,
proposal creation, submitter ownership enforcement, blocked dependency-tree
uploads, broken local reference finalization blocking, relative file upload
preservation, public status before and after finalization, noop/not-judged public
risk state, proposal/file judgement creation, admin login, admin proposal detail,
admin conversion into a draft skill, draft non-public visibility, admin publish,
admin rejection, privileged cleanup of an abandoned `in_upload` proposal, and
state-blocked deletion of a converted proposal.

## Outputs

- `.tmp/proposal-lifecycle.log`
- `.tmp/proposal-lifecycle.json`

Successful runs end with `RESULT=PASS`.
