# Spec: SkillNameSuggestionController (HTTP Adapter)

## Purpose

HTTP adapter for skill-ID name suggestions.

## Scope

- `POST /skills/suggest-name`

## Non-Scope

- Skill creation
- Name reservation

## Responsibilities

- Accept title/description.
- Call `SkillNameSuggestionPort`.
- Return suggestion plus alternatives.

## Inputs / Outputs

- Inputs: `{ title, description? }`
- Outputs: `{ suggestion, alternatives, isAvailable }`

## Dependencies

- `SkillNameSuggestionPort`

## Failure Modes

- Missing title -> 422
- No valid suggestion -> 422

## Acceptance Criteria

- Endpoint is publicly available.
- Response follows skill ID rules.

## Tests / Checks

- HTTP integration tests

## Agent Guardrails

- Do not persist the suggestion without explicit creation.
