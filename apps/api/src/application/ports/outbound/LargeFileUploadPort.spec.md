# Spec: LargeFileUploadPort (Historical Placeholder)

## Purpose

Historical placeholder for an earlier wrapper/CLI path for large uploads. The
canonical proposal upload contract is now described by `GET /howToPropose` and
implemented locally by the user's agent.

## Scope

- Documents that no project-specific wrapper is required anymore.
- Points to the agentic preflight contract.

## Non-Scope

- Browser drag-and-drop for large files in the MVP
- Resumable uploads

## Responsibilities

- No active runtime responsibility.
- Exists only as a documentation anchor for replacing the earlier wrapper idea.

## Inputs / Outputs

- None

## Dependencies

- `GET /howToPropose`

## Failure Modes

- Not applicable

## Acceptance Criteria

- The specification makes clear that the product contract is not coupled to a
  specific local script.

## Tests / Checks

- Documentation consistency checks

## Agent Guardrails

- Local agents must follow the proposal preflight from `GET /howToPropose`.
