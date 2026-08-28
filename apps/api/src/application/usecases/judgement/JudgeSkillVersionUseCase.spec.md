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
- Build a canonical global input from metadata and file descriptors, then call
  the judger only when no compatible judgement is supplied for reuse.
- When storage/scanner dependencies are available, also judge each stored file
  in the selected version and project those file judgements under
  `targetType=file` with target ID `<skillId>:<version>:<path>`.
- Mirror skill and file judgements into audit and SQLite projection for later
  read paths.
- Persist only allow-listed error categories, never raw provider/scanner error
  messages or adapter-controlled error names, in audit entries and runtime
  events.

## Inputs / Outputs

- Input: `skillId`, `version`, optional legacy `contextText`, observability-only
  conversion context, and reusable proposal judgements
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
- Judgements whose canonical input fingerprint, prompt version, model, and
  configured reuse scope match are cloned for the new skill/version target;
  unmatched content is judged again.
- Legacy `contextText` is appended to the canonical global input and therefore
  changes the fingerprint; `contextMetadata` is observability-only and never
  changes the provider input.
- File judgement execution is bounded by `JUDGER_MAX_CONCURRENCY` at composition
  time; this use case preserves the configured scheduler contract.
- With catalog projection available, the use case does not need repository
  rehydration for version metadata.

## Tests / Checks

- Typecheck
- API/use-case tests through calling controller

## Agent Guardrails

- Do not force persistence in the use case beyond the defined projection/audit
  behavior.
