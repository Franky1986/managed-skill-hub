# NEXT_STEPS

## EPIC-003

EPIC-003 is complete. Future language-related changes should preserve:

- English canonical docs, specs, OpenAPI descriptions, API guidance, scripts,
  and agent-facing instructions.
- English UI default with German available through the frontend language toggle.
- English-only agent-facing endpoints that still instruct agents to answer the
  user in the user's current language.
- Existing skill content, proposal artifacts, audit/history data, and
  user/admin-generated free-form text as content artifacts that are not
  translated unless a separate content-specific task explicitly requests it.

Before closing future language work, run the German-text search checklist and
`./scripts/check.sh`.

## Product Follow-Ups Outside EPIC-003

- EPIC-009 follow-up: decide whether production-specific MySQL dump/restore automation should be added beyond the current explicit fail-fast guard and documentation.
- Improve judgement consistency across proposal overview, proposal detail, and
  skill context views.
- EPIC-004: continue implementation of the `vercel-ai-sdk` judger provider in
  parallel to existing public/internal provider options.
- Improve proposal detail UX for unauthorized sessions, for example by routing
  expired admin sessions back to login after showing a clear error.
- Expand end-to-end coverage for the auto-publish path, including controller
  tests for finalize-upload responses and UI tests for `in_upload` and
  auto-publish visibility.
- Expand smoke tests for admin proposal/skill/judgement flows.
- Decide whether rejected skill versions need a separate archived/rejected admin
  view beyond their current visibility in the review queue.
- Harden duplicate-check UX and agent-side preflight heuristics.
- EPIC-010 follow-up: evolve the implemented first-stage portable `commands/`
  validation and manifest convention into deterministic consumer-side install
  mapping for Cursor, Codex, Claude Code, and generic runtimes.
- Feature request: add a stateless proposal preflight endpoint for checking a
  skill package before submission. It should accept metadata plus deterministic
  per-file extraction payloads (`path`, `mimeType`, `sizeBytes`, `sha256`,
  extraction method, raw extracted text, truncation metadata), avoid agent-side
  inference or summarization, enforce file/character limits, and return
  structured package/file checks, duplicate signals, normalization advice, and
  optional judgement output without persisting workflow state.
- Validate a representative third-party custom judger adapter end-to-end against
  a running API server outside restrictive sandbox environments.
- Public-release security follow-up: validate the documented reverse-proxy
  request, connection, and body limits in the target production environment
  and keep the zero-vulnerability lockfile audit as a release gate.
- Evaluate a shared gateway or datastore-backed proposal limiter before running
  multiple API instances; the built-in limiter intentionally remains
  process-local.
- EPIC-007 follow-up: evaluate multi-token stores, API gateway asserted identity,
  OAuth/OIDC setup UX, and richer per-consumer audit attribution after the
  static bearer phase.
- Plan productionization: authentik/OIDC, CI/CD, dependency consolidation, and
  operational integrity checks.
- Evaluate web chunk splitting if the current Vite production bundle warning
  becomes a startup or cache-performance concern.

## Completed Baselines

### EPIC-001

The initial MVP foundation is implemented. See
[`docs/roadmap/EPIC-001-mvp.md`](../roadmap/EPIC-001-mvp.md).

### EPIC-002

Agent Workbench UI and registry hardening are functionally complete. See
[`docs/roadmap/EPIC-002-STATUS.md`](../roadmap/EPIC-002-STATUS.md).
