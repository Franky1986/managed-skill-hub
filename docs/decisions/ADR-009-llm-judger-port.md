# ADR-009: LLM Judger As Replaceable Port

## Status

Accepted

## Context

Risk assessment should not be coupled to a specific LLM provider.

## Decision

- `SkillJudgerPort` abstracts LLM integration.
- The default runtime options are `noop` and `vercel-ai-sdk`.
- Custom providers can be added by setting `JUDGER_PROVIDER` to an arbitrary provider key and
  `JUDGER_ADAPTER_PATH` to a module implementing `SkillJudgerPort`.
- Additional providers can be added through adapter modules without changing application
  domain logic.

## Consequences

- Domain and application do not depend on a specific LLM.
- Judgements can already be modeled even before a real integration exists.
