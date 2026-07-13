# Spec: SkillNameSuggestionPort (Inbound Port)

## Purpose

Suggests a valid, unique skill ID from title, optional description, and the
skill ID rules.

## Scope

- `suggestSkillId(title, description?)`
- uniqueness check
- alternatives on collision

## Non-Scope

- Automatic skill creation
- Reservation of the suggested name

## Responsibilities

- Convert title into slug-style ID.
- Detect collisions.
- Generate alternative suggestions.

## Inputs / Outputs

- Inputs: `{ title, description? }`
- Outputs: `{ suggestion: string, alternatives: string[], isAvailable: boolean }`

## Dependencies / Ports

- `SkillRepositoryPort` to check existence
- `ProposalRepositoryPort`, optional, if proposal names are checked too

## Failure Modes

- Missing title -> `ValidationError`
- No valid ID derivable -> `ValidationError`

## Acceptance Criteria

- Suggestion follows skill ID rules.
- Alternatives are returned on collision.
- Endpoint is publicly available.

## Tests / Checks

- Unit tests for slug generation
- Integration tests for uniqueness checks

## Agent Guardrails

- Do not persist the suggestion without explicit creation.
