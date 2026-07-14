# Spec: ReviewSkillUseCase (Application)

## Purpose

Runs domain status transitions for existing skill versions and handles audit and
search-index consequences.

## Scope

- `submitForReview(id, version, actor)`
- `approve(id, version, actor)`
- `publish(id, version, actor, options?)`
- `reject(id, version, actor, reason)`
- `deprecate(id, version, actor)`

## Non-Scope

- Skill creation or file mutations
- UI/HTTP-specific error presentation

## Responsibilities

- Load skill aggregate for requested status transition.
- When catalog projection exists, preferably hydrate skill directly from SQLite
  metadata plus projected file metadata.
- Execute domain status transition on aggregate.
- Persist updated skill aggregate through repository.
- Write audit entry.
- On `publish`, build search index with extractable file contents.
- Before `publish`, apply `PUBLISH_JUDGEMENT_POLICY`: skip for `disabled`, audit
  and continue for `warn`, or require a real skill-version judgement plus a real
  judgement for every extractable file for `required`.
- Allow only an administrator-authorized, non-empty, audited reason to override
  a `required` judgement gate.
- On `reject`, mark a draft, in-review, or approved version as rejected and
  persist the required rejection reason in audit and metadata projections.
- On `deprecate`, remove search index entry.

## Inputs / Outputs

- Inputs: `skillId`, `version`, `actor`, optional transition-specific reason
- Outputs: updated `Skill` aggregate

## Dependencies

- `SkillRepositoryPort`
- optional `SkillCatalogPort`
- `AuditLogPort`
- `SkillFileStoragePort`
- `FileScannerPort`
- `SkillSearchPort`

## Failure Modes

- Skill not found -> `NotFoundError`
- Invalid status transition -> domain error
- Failed extraction on `publish` -> single file is ignored, publish still
  succeeds
- Missing required judgements -> `JudgementRequiredError`
- Empty administrator override reason -> `ValidationError`

## Acceptance Criteria

- Status transitions follow domain rules.
- Rejection is available before publication and requires a non-empty reason.
- With catalog projection available, the use case does not need repository
  rehydration for status basis.
- `publish` indexes the published version in search.
- `required` publication does not accept `noop`, `no_judge_available`, or
  model-less judgement placeholders as real judgements.
- `deprecate` removes the version from search.

## Tests / Checks

- Use-case tests for publish/deprecate and catalog-backed skill loading
- `./scripts/check.sh`
