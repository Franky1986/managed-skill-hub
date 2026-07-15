# Spec: SkillJudgerPort (Outbound Port)

## Purpose

Assesses proposals, skills, versions, or individual files for risks through an
LLM.

## Scope

- `judgeProposal(proposal)`
- `judgeSkillVersion(skillVersion)`
- `judgeFile(fileReference, content/text)`
- optional `assessDuplicateSimilarity(input)` for bounded internal duplicate
  enrichment

## Non-Scope

- Approval decision
- Model training

## Responsibilities

- Base assessment on extracted text plus metadata, not raw files.
- Provide structured risk and quality-fit assessment.
- Be callable asynchronously.
- Be provider-agnostic.
- Support custom judger as concrete adapter implementation.
- When auto-judgement is enabled, report transport-related errors clearly.
- Treat all compared metadata and content as untrusted data. Provider prompts
  must forbid following embedded instructions and must not ask the model to quote
  or reveal submitted content.

## Inputs / Outputs

- Inputs: object plus extracted texts/metadata
- Outputs: `Judgement`
- Duplicate output: score in `[0,1]`, high-level reason, optional model metadata

## Dependencies

- `FileScannerPort` for text extraction

## Failure Modes

- Provider unreachable -> `JudgerUnavailableError`
- Timeout -> `JudgerTimeoutError`
- Unknown file type -> `UnsupportedFileTypeError`
- Invalid provider response -> `JudgerProtocolError`

## Acceptance Criteria

- Assessment contains defined dimensions.
- Port is replaceable: stub, custom-judger, another provider.
- Provider adapters share the same judgement prompt/output contract so risk
  and quality-fit dimensions and score normalization do not diverge.
- Results are stored in proposal/skill.
- custom judger adapter can use alias, procedure, or version route depending on
  configuration.

## Tests / Checks

- Contract tests with stub
- Timeout tests
- Adapter tests for parsing custom judger response

## Agent Guardrails

- No LLM-specific prompt code outside the adapter.
- Do not send PII or secrets to the judger.
- Never invoke semantic duplicate comparison from the public preflight endpoint.
