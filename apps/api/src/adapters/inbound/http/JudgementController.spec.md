# Spec: JudgementController (HTTP Adapter)

## Purpose

HTTP adapter for LLM judgement operations.

## Scope

- `POST /admin/proposals/:proposalId/judge`
- `POST /admin/proposals/:proposalId/files/:fileId/judge`
- `POST /admin/judge/skill/:skillId/version/:version`
- `POST /admin/judge/file`, direct file upload for checking
- `GET /admin/judgements/:targetType/:targetId`

## Non-Scope

- Approval decision
- Training-data management

## Responsibilities

- Accept judgement requests.
- Call `SkillJudgerPort`.
- Return results.
- Open on-demand and stored judgement routes only to authenticated admins
  because they are review functionality.
- Deliver stored judgements only to authenticated admins because they are review
  data.
- Return provider, timeout, and validation errors through normalized JSON
  contract with `error`, `code`, `requestId`.
- Read stored proposal/file/skill judgements preferably from SQLite projection
  before falling back to YAML/audit rehydration.
- Treat empty SQLite judgement results as valid response instead of falling back
  only because of zero hits.

## Inputs / Outputs

- Inputs: proposal ID, skill/version, file, admin session
- Outputs: `Judgement` JSON

## Dependencies

- `SkillJudgerPort`

## Failure Modes

- Not logged in for on-demand or stored judgement read/write -> `401`
- Judger unreachable -> 503
- Unknown file type -> 422
- Timeout -> 504
- Error responses contain at least `error`, `code`, `requestId`

## Acceptance Criteria

- Admin sees assessments for proposals.
- Proposal judgement and file judgement use configured `SkillJudgerPort`.
- Stored proposal-file retry persists the result and remains available after
  proposal conversion so operators can repair an incomplete judgement history.
- Timeout/provider errors are translated into suitable HTTP status codes.
- On-demand judgement POSTs require valid admin session.
- `POST /admin/judge/skill/:skillId/version/:version` judges a concrete skill
  version on demand.
- `GET /admin/judgements/:targetType/:targetId` returns stored judgements only
  with valid admin session.

## Tests / Checks

- HTTP integration tests with stub judger
- Timeout tests

## Agent Guardrails

- No LLM-specific details in controller.
