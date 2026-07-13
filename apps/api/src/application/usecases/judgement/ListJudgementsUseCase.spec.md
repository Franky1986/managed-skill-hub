# Spec: ListJudgementsUseCase (Application)

## Purpose

Returns stored judgements for a target object.

## Scope

- `execute(targetType, targetId)`

## Non-Scope

- On-demand recalculation of judgements
- Persisting new judgements

## Responsibilities

- Load proposal judgements directly from proposal.
- Filter file judgements across proposals.
- Reconstruct persisted skill judgements from audit log.

## Inputs / Outputs

- Input: `targetType`, `targetId`
- Output: list of `Judgement`

## Dependencies

- `SkillRepositoryPort`

## Failure Modes

- Unknown target type -> `ValidationError`

## Acceptance Criteria

- Proposal targets return proposal judgements.
- File targets return matching file judgements.
- Skill targets return stored skill judgements.

## Tests / Checks

- Use-case tests for proposal and file targets

## Agent Guardrails

- No search logic outside the use case.
