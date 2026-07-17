# check-observability-audit.ts Spec

## Purpose

Provide deterministic release evidence that important agent and admin state transitions are visible through observability metrics and are written to the audit log.

## Scope

The proof runs against the real Fastify route stack with an isolated SQLite-backed data directory under `.tmp/observability-audit-data`.
Runtime packages are resolved through the npm workspace graph rather than a
hard-coded workspace `node_modules` path.

It validates:

- Public discovery requests are classified as retrieval traffic.
- Proposal creation, file upload, and finalization are classified as proposal traffic.
- Admin login is classified as auth traffic.
- Admin proposal detail access is classified as review traffic.
- Admin proposal conversion, skill publish, proposal rejection, and projection rebuild routes succeed through the real admin API.
- Admin observability metrics and JSON/CSV exports are available behind admin auth.
- Observability snapshots include retrieval, proposal, auth, review, publish, and observability areas where applicable.
- Recent request observations preserve the proposal id for proposal-scoped routes.
- Proposal audit JSONL includes submission, file attachment, upload finalization, and rejection actions.
- Skill/global audit JSONL includes conversion, publish, and projection rebuild actions.

## Artifacts

- `.tmp/observability-audit.log`
- `.tmp/observability-audit.json`

## Non-Goals

- Browser UI rendering checks.
- Long-running production metrics retention checks.
- MySQL parity checks; provider parity is covered by separate proof scripts.
