# Spec: Proposal (Domain Entity)

## Purpose

A proposal is a suggestion for a new skill or a change to an existing skill,
submitted by an agent or a human. Proposals are standalone objects and become a
skill or skill version only after approval.

## Scope

- Own UUID per proposal
- Optional relationship to a skill ID for updates to existing skills
- Manifest, description, files
- Status lifecycle
- Timestamps and submitter

## Non-Scope

- Direct publication without approval
- Content mutations after submission; admins may only change status

## Responsibilities

- Make suggestions persistable with revision safety
- Allow multiple proposals under the same skill ID in chronological order
- Provide the basis for LLM judgement and admin review

## Inputs / Outputs

- Inputs: optional skill ID, title, description, manifest, files, submitter
- Outputs: proposal entity with UUID, status, timestamps

## Dependencies / Ports

- `ProposalRepositoryPort`
- `SkillJudgerPort`
- `AuditLogPort`

## Failure Modes

- Invalid skill ID reference -> `ValidationError`
- Missing title/description -> `ValidationError`
- Duplicate UUID -> `ConflictError`

## Acceptance Criteria

- Every proposal has a UUID.
- Proposals under the same skill ID can be sorted chronologically.
- A proposal cannot be changed in content after submission.
- Persisted proposals can be fully rehydrated including files, judgements, and
  status.

## Tests / Checks

- Unit tests for lifecycle and UUID generation
- Validation tests

## Agent Guardrails

- Never reuse proposal IDs.
- Do not put approval business logic into proposal code.
