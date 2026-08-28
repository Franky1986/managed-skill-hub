# Spec: JudgeProposalUseCase (Application)

## Purpose

Runs a KI-based judgement on a proposal and persists the result as updated
proposal state plus audit entry.

## Scope

- `execute(proposalId)`
- `executeFile(proposalId, fileIdOrPath)`

## Non-Scope

- Skill-version judgements
- Final admin review decisions
- UI/HTTP-specific error presentation

## Responsibilities

- Load proposal aggregate for judgement.
- When catalog projection exists, preferably hydrate proposal directly from
  SQLite metadata, proposal files, and projected judgements.
- Call judger with proposal core data: `title`, `description`, `groups`,
  `capabilities`.
- Include attached proposal file metadata and content hashes in the canonical
  proposal-level judgement context. Extracted artifact text is assessed by the
  separate per-file judgement target, preserving a stable reusable global
  input while retaining content-level findings.
- Persist updated proposal with new judgement through repository.
- Write audit entry for proposal judgement.
- Re-run judgement for one stored proposal file, including extraction where
  needed, and persist an auditable failure when the provider call fails.
- Emit structured runtime events without including proposal content or raw
  provider errors.
- Fingerprint each canonical global or file input with the configured prompt
  version and reuse scope before persistence.

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
- Missing proposal file -> `NotFoundError`

## Acceptance Criteria

- Proposal is stored as `judged` after a successful run.
- Existing proposal files and already projected judgements remain preserved when
  loading through the catalog.
- Proposal re-judgement uses canonical metadata and file descriptors; separate
  file judgements assess attached artifact content and surface content-level
  quality-fit issues.
- With catalog projection available, the use case does not need repository
  rehydration for proposal basis.
- The new judgement is referenced in audit.
- Re-judging a converted or rejected proposal does not reopen its terminal
  lifecycle status.
- A failed retry is visible as the latest execution state even if an older
  successful judgement exists.

## Tests / Checks

- Use-case tests for normal persistence path and catalog-backed proposal load
- `./scripts/check.sh`
