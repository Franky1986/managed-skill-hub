# Spec: JudgeSkillVersionUseCase (Application)

## Purpose

Assesses one concrete skill version on demand through the configured
`SkillJudgerPort`.

## Scope

- `execute(skillId, version)`

## Non-Scope

- Persisting skill judgements as domain state
- Publish/review workflow

## Responsibilities

- Load skill version preferably from SQLite catalog projection or otherwise from
  repository.
- Serialize skill version into transportable text/metadata input.
- Call judger and return the skill-level result.
- When storage/scanner dependencies are available, also judge each stored file
  in the selected version and project those file judgements under
  `targetType=file` with target ID `<skillId>:<version>:<path>`.
- Mirror skill and file judgements into audit and SQLite projection for later
  read paths.

## Inputs / Outputs

- Input: `skillId`, `version`
- Output: `Judgement`

## Dependencies

- `SkillRepositoryPort`
- optional `SkillCatalogPort`
- `SkillJudgerPort`
- `AuditLogPort`
- optional `SkillFileStoragePort`
- optional `FileScannerPort`

## Failure Modes

- Skill not found -> `NotFoundError`
- Version not found -> `NotFoundError`
- Judger error -> port-specific errors

## Acceptance Criteria

- Existing skill version can be judged on demand.
- Result is returned as `targetType = skill`.
- Individual file judgements are persisted for artifact explorers when file
  content can be read and scanned.
- With catalog projection available, the use case does not need repository
  rehydration for version metadata.

## Tests / Checks

- Typecheck
- API/use-case tests through calling controller

## Agent Guardrails

- Do not force persistence in the use case beyond the defined projection/audit
  behavior.
