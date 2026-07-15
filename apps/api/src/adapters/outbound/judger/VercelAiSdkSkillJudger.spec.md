# Spec: VercelAiSdkSkillJudger (Outbound Adapter)

## Purpose

Provide a concrete `SkillJudgerPort` implementation backed by the Vercel AI SDK.

## Scope

- Resolve model IDs from a compact `provider:model` string.
- Pass shared prompt contract and max text limits to the AI SDK call.
- Validate provider output with structured output schema and then reuse the shared judgement
  parser, safety/quality-fit dimensions, and domain `Judgement` creation.
- Support structured auto-publish category classification and semantic duplicate
  similarity assessment through dedicated prompt/output contracts.
- Fail fast for invalid model configuration and map transport/protocol failures
  to domain-specific judger errors.

## Non-Scope

- File extraction
- Approval decision
- Provider account provisioning

## Responsibilities

- Resolve models through the provider registry (`vercel-ai-sdk.registry.ts`) at
  adapter construction time.
- Call `generateObject` with the relevant Zod schema, timeout signal, and retry limit.
- Delimit and encode duplicate-comparison content as untrusted data so submitted
  text cannot terminate the prompt sections.
- Handle timeout, unavailable, and invalid structured output with explicit domain errors.
- Return an immutable `Judgement` created by the shared contract.

## Inputs / Outputs

- Input: `JudgementTarget`
- Output: `Judgement`

## Dependencies

- `ai` structured-output transport
- `@ai-sdk/openai` as default registry provider
- `judgement-contract` for prompt text and domain mapping

## Failure Modes

- Timeout -> `JudgerTimeoutError`
- Structured output mismatch -> `JudgerProtocolError`
- Network/provider failures -> `JudgerUnavailableError`
- Invalid `provider:model` format or unsupported provider -> `ValidationError`
  during adapter construction/startup.

## Acceptance Criteria

- Adapter uses `buildJudgementSystemPrompt()` and `buildJudgementUserPrompt()`.
- Structured output is parsed via shared `parseJudgementOutput()`.
- Adapter sets model metadata to `vercel-ai-sdk:<model-id>`.
- Invalid model configuration fails before the first judgement request.
- Duplicate reasons remain high level and the prompt forbids quoting compared content.
