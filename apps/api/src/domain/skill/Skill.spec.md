# Spec: Skill (Domain Entity)

## Purpose

A skill is the domain unit of the skill registry. It represents a manageable,
versionable, and approvable set of knowledge, instructions, and files for AI
agents.

## Scope

- Unique identification through `SkillId`
- Lifecycle management: draft, in_review, approved, published, deprecated
- Reference to the currently published version
- Ownership and audit information

## Non-Scope

- Storage of file contents
- Search index
- Authentication

## Responsibilities

- Validate status transitions
- Ensure approvals are attached to concrete versions
- Provide stable identity independent of versions

## Inputs / Outputs

- Inputs: create/update commands, actor, timestamp
- Outputs: skill entity with current status and version

## Dependencies / Ports

- `SkillRepositoryPort` for persistence
- `AuditLogPort` for change log

## Failure Modes

- Invalid status transition -> domain error
- Skill without version -> `InvalidStateError`
- Duplicate ID -> repository error

## Acceptance Criteria

- Status transitions are possible only in the allowed order.
- Every status change creates an audit entry.
- `published` is reachable only when a version has been approved.

## Tests / Checks

- Unit tests for state machine
- Unit tests for identification and equality

## Agent Guardrails

- Never set status fields directly; always use domain methods.
- Do not make assumptions about persistence format in domain code.
