# EPIC-004: Vercel AI SDK Judger Provider

## Status

In Progress

## Objective

Add a `vercel-ai-sdk` judger provider that runs in parallel with the existing
`custom-judger` provider while keeping all judgement semantics provider-neutral.
The registry should be able to switch the active LLM judgement backend through
configuration without changing proposal, skill, file, or review use cases.

## Context

The current judgement flow is already exposed through `SkillJudgerPort`.
`CustomJudgerSkillJudger` now owns only custom judger transport concerns and delegates
prompt construction, text truncation, output parsing, risk dimensions, score
normalization, and `Judgement` creation to the shared judgement contract.

The next provider should use the Vercel AI SDK directly, not Vercel AI Gateway.
Provider credentials stay in environment variables for the selected direct
provider, for example `OPENAI_API_KEY` for OpenAI.

## Non-Goals

- Do not introduce Vercel AI Gateway.
- Do not create one judger adapter per LLM vendor.
- Do not change the domain `Judgement` model unless the shared contract proves
  insufficient.
- Do not change proposal, skill, file, or review use case behavior.
- Do not store provider API keys in repository files.

## Provider Naming

The provider name is:

```text
vercel-ai-sdk
```

Configuration uses:

```text
JUDGER_PROVIDER=vercel-ai-sdk
```

## Architecture

```text
Use cases
  -> SkillJudgerPort
    -> NoopSkillJudger
    -> CustomJudgerSkillJudger
    -> VercelAiSdkSkillJudger
         -> shared judgement contract
         -> AI SDK provider registry
         -> direct provider package, e.g. @ai-sdk/openai
```

Shared judgement behavior remains in:

```text
apps/api/src/adapters/outbound/judger/judgement-contract.ts
```

Provider-specific behavior belongs only in provider adapters.

## Required Dependencies

Initial implementation:

- `ai`
- `@ai-sdk/openai`

Potential later additions:

- `@ai-sdk/anthropic`
- `@ai-sdk/google`
- `@ai-sdk/mistral`
- OpenAI-compatible provider support, if needed

The repository Node engine remains unchanged for this epic. Before
implementation, verify the selected AI SDK version against the current project
engine. If the latest AI SDK version requires a newer Node.js runtime, pin a
compatible AI SDK version intentionally instead of raising the engine
requirement in this epic.

## Environment Contract

Existing providers remain valid:

```env
JUDGER_PROVIDER=noop
JUDGER_PROVIDER=custom-judger
```

New provider:

```env
JUDGER_PROVIDER=vercel-ai-sdk
VERCEL_AI_SDK_MODEL=openai:gpt-4.1
VERCEL_AI_SDK_TIMEOUT_MS=30000
VERCEL_AI_SDK_MAX_TEXT_CHARS=12000
VERCEL_AI_SDK_MAX_RETRIES=0
OPENAI_API_KEY=...
```

Rules:

- `JUDGER_PROVIDER=vercel-ai-sdk` must fail fast when
  `VERCEL_AI_SDK_MODEL` is missing.
- Provider API keys are read by their provider packages from standard
  environment variables where possible.
- There is no automatic provider selection for this epic. `JUDGER_PROVIDER`
  must explicitly select `noop`, `custom-judger`, or `vercel-ai-sdk`.
- `auto` mode should be removed or rejected during configuration parsing rather
  than silently selecting a provider.
- `VERCEL_AI_SDK_MAX_TEXT_CHARS` should default to the existing custom judger
  default unless explicitly overridden.
- `VERCEL_AI_SDK_MAX_RETRIES` defaults to `0` so automatic judgement requests
  do not silently multiply provider cost.
- `VERCEL_AI_SDK_TIMEOUT_MS` controls total request timeout.

The initial documented model ID format is:

```text
openai:gpt-4.1
```

No runtime default model should be assumed when the provider is explicitly set
to `vercel-ai-sdk`; missing model configuration is a startup error.

### Locked Decisions

- Keep repository Node version unchanged for this epic.
- OpenAI is the first supported direct Vercel AI SDK provider, with `openai:<model>`
  as the canonical model ID format.
- Use structured output via `Output.object({ schema })`.
- Use `VERCEL_AI_SDK_TIMEOUT_MS` as the definitive request timeout.
- Do not support an auto provider mode in this epic.
- Do not add automatic cost controls beyond configured `VERCEL_AI_SDK_MAX_RETRIES`.
- No provider-PII handling is introduced in this epic.

## Implementation Plan

### 1. Ignore Runtime Data

  - Treat `data/` as runtime state.
  - Keep runtime data out of Git.
  - Do not remove local files from disk when removing them from Git tracking.
  - Completed.

### 2. Extend Configuration

Files:

- `apps/api/src/infrastructure/config.ts`
- `apps/api/src/infrastructure/config.spec.md`
- `docs/setup/ENVIRONMENT.md`
- `.env.example`

Changes:

- Replace provider auto-selection with explicit provider selection.
  - Extend `judgerProvider` with `vercel-ai-sdk`.
  - `JUDGER_PROVIDER` is now required and `auto` is rejected.
- Add `vercelAiSdkModel`.
- Add `vercelAiSdkTimeoutMs`.
- Add `vercelAiSdkMaxTextChars`.
- Add `vercelAiSdkMaxRetries`.
- Document provider API key expectations.

### 3. Add Provider Registry

New file:

```text
apps/api/src/adapters/outbound/judger/vercel-ai-sdk.registry.ts
```

Responsibilities:

- Create the AI SDK provider registry.
- Register initially supported direct providers.
- Resolve model strings such as `openai:gpt-4.1`.
- Keep provider package imports isolated from the main adapter.

### 4. Add `VercelAiSdkSkillJudger`

New files:

```text
apps/api/src/adapters/outbound/judger/vercel-ai-sdk.judger.ts
apps/api/src/adapters/outbound/judger/VercelAiSdkSkillJudger.spec.md
apps/api/src/adapters/outbound/judger/vercel-ai-sdk.judger.test.ts
```

Responsibilities:

- Implement `SkillJudgerPort`.
- Use `generateText` with `output: Output.object({ schema })` and consume
  `result.output` for structured output
  (current `ai` package API).
- Use `buildJudgementSystemPrompt()`.
- Use `buildJudgementUserPrompt()`.
- Use structured output validation through the shared judgement schema.
- Create domain judgements through the shared judgement contract.
- Pass total timeout and retry settings to the AI SDK call.
- Set model metadata in the format:

```text
vercel-ai-sdk:<model-id>
```

### 5. Wire The Container

File:

```text
apps/api/src/infrastructure/container.ts
```

Changes:

- Import `VercelAiSdkSkillJudger`.
- Extend `buildJudger()`.
- Keep existing `noop` and `custom-judger` behavior unchanged.
- Fail fast for explicit `vercel-ai-sdk` misconfiguration.
- Do not select a provider automatically from ambient API keys.

### 6. Error Mapping

Map AI SDK and provider failures into existing domain errors:

- timeout -> `JudgerTimeoutError`
- authentication, network, provider unavailable -> `JudgerUnavailableError`
- invalid structured output -> `JudgerProtocolError`

No AI SDK-specific error shape should leak past the adapter.

### 7. Tests

Required tests:

- Config parsing rejects missing or unsupported `JUDGER_PROVIDER`.
- Config parsing for `JUDGER_PROVIDER=vercel-ai-sdk`.
- Config parsing reads `VERCEL_AI_SDK_MAX_RETRIES`.
- Provider registry resolves supported model strings.
- Vercel AI SDK adapter sends shared prompts.
- Vercel AI SDK adapter returns a domain `Judgement`.
- Vercel AI SDK adapter maps timeout/provider/protocol errors.
- Vercel AI SDK adapter passes `timeout` and `maxRetries` to the AI SDK call.
- Existing custom judger tests remain green.

Required checks:

```bash
npm run typecheck --workspace=apps/api
npm run lint --workspace=apps/api
npm run test --workspace=apps/api -- src/adapters/outbound/judger/judgement-contract.test.ts src/adapters/outbound/judger/custom-judger.judger.test.ts src/adapters/outbound/judger/vercel-ai-sdk.judger.test.ts
./scripts/check.sh
```

## Acceptance Criteria

- `JUDGER_PROVIDER=custom-judger` still works unchanged.
- `JUDGER_PROVIDER=noop` still works unchanged.
- `JUDGER_PROVIDER=vercel-ai-sdk` selects the new provider.
- Unsupported or missing `JUDGER_PROVIDER` fails fast.
- `auto` provider selection is not available.
- The new provider reuses the shared judgement contract.
- Prompt text, expected dimensions, score normalization, and judgement creation
  are not duplicated in the new provider.
- No Vercel AI Gateway code or configuration is introduced.
- Runtime `data/` content is not tracked by Git.

## Risks And Decisions

- AI SDK version may require a higher Node.js engine than the current
  repository minimum; this epic keeps the engine unchanged and should pin a
  compatible AI SDK version if needed.
- Direct providers may require separate provider packages and API keys.
- Model string compatibility should be documented per enabled provider.
- No automatic provider selection is allowed in this epic.
- Judgement retries default to zero to avoid accidental cost multiplication.
