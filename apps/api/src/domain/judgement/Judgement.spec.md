# Spec: Judgement (Domain Value Object / Entity)

## Purpose

A judgement contains the result of an LLM-based assessment of a proposal, skill,
or individual file for risks and review fit such as harmful content, prompt
injection, data exfiltration, or content that does not fit the declared skill
purpose.

## Scope

- Judged object: proposal, skill, skill version, file
- Judged dimensions: harmful, promptInjection, dataExfiltration,
  policyViolation, qualityFit
- Overall score or risk level: low/medium/high/critical
- Rationale / quotes
- Concise purpose summary describing what the judged skill or material is meant
  to do, when the model can infer one
- Timestamp and used model/provider

## Non-Scope

- Training or fine-tuning the LLM
- Final approval decision; this remains with the admin

## Responsibilities

- Store judgement results in a structured and traceable way
- Provide decision support for admins
- Allow agents to assess suggestions before submission

## Inputs / Outputs

- Inputs: object to judge plus content/text extracts
- Outputs: judgement with dimensions, score, rationale, and optional
  `skillPurposeSummary`

## Dependencies / Ports

- `SkillJudgerPort`, later calling custom-judger or another provider
- `FileScannerPort` for text extraction

## Failure Modes

- Judger unavailable -> `JudgerUnavailableError`
- Unknown file type -> `UnsupportedFileTypeError`
- Timeout -> `JudgerTimeoutError`

## Acceptance Criteria

- Every judgement uniquely references the judged object.
- Dimensions are clearly defined and standardized.
- Result is readable by humans and machines.
- Skill-level judgements can expose a concise `skillPurposeSummary` for list
  and search views without forcing clients to parse free-form risk summaries.

## Tests / Checks

- Unit tests for aggregation of dimensions
- Stub tests for judger port

## Agent Guardrails

- Never treat judgement results as final approval.
- Do not include secrets or PII in judgement inputs.
