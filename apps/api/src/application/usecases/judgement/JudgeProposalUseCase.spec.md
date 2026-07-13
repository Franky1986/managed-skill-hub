# Spec: JudgeProposalUseCase (Application)

## Purpose

Runs a KI-based judgement on a proposal and persists the result as updated
proposal state plus audit entry.

## Scope

- `execute(proposalId)`

## Non-Scope

- Separate file or skill judgements
- Final admin review decisions
- UI/HTTP-specific error presentation

## Responsibilities

- Load proposal aggregate for judgement.
- When catalog projection exists, preferably hydrate proposal directly from
  SQLite metadata, proposal files, and projected judgements.
- Call judger with proposal core data: `title`, `description`, `groups`,
  `capabilities`.
- Include attached proposal file metadata and extracted text in the proposal
  judgement context when storage/scanner dependencies are available, so the
  proposal-level judgement can explain content-level fit issues.
- Persist updated proposal with new judgement through repository.
- Write audit entry for proposal judgement.

## Inputs / Outputs

- Input: `proposalId`
- Output: created `Judgement`

## Dependencies

- `SkillRepositoryPort`
- optional `SkillCatalogPort`
- `SkillJudgerPort`
- `AuditLogPort`
- optional `SkillFileStoragePort`
- optional `FileScannerPort`

## Failure Modes

- Proposal not found -> `NotFoundError`
- Judger error -> pass through judger error

## Acceptance Criteria

- Proposal is stored as `judged` after a successful run.
- Existing proposal files and already projected judgements remain preserved when
  loading through the catalog.
- Proposal re-judgement can include attached file content and should surface
  proposal-level quality-fit issues found in those files.
- With catalog projection available, the use case does not need repository
  rehydration for proposal basis.
- The new judgement is referenced in audit.

## Tests / Checks

- Use-case tests for normal persistence path and catalog-backed proposal load
- `./scripts/check.sh`
