# Spec: AuditLogPort (Outbound Port)

## Purpose

Records relevant registry actions in a revision-safe way, including skill-scoped, proposal-scoped, and global operational actions.

## Scope

- `append(entry: AuditEntry)`
- `findBySkillId(skillId)`
- `findByProposalId(proposalId)`
- `findAll()`

## Non-Scope

- Authentication
- Business rules

## Responsibilities

- Immutable append-only log
- Timestamp, actor, action, before/after snapshot
- Scoped reads for skill and proposal history
- Full enumeration for migration, export, and projection rebuild evidence
- Keep physical audit storage separate from later catalog/read projections

## Inputs / Outputs

- Inputs: `AuditEntry`
- Outputs: `AuditEntry[]`

## Dependencies

- None

## Failure Modes

- Log not writable -> `AuditError`
- Log corruption -> recovery through backup

## Acceptance Criteria

- Every status change and admin action is recorded.
- Global operational actions such as projection rebuilds remain readable through `findAll()`.
- Log entries must not be changed after the fact.

## Tests / Checks

- Contract tests for `FileSystemAuditLog`

## Agent Guardrails

- Always write the audit log in the same work step as the action.
- Do not log unnecessary PII.
