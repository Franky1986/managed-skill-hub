# ADR-006: Proposals And LLM Judgements

## Status

Accepted

## Context

Agents should be able to propose skills without publishing directly. Admin keeps
approval authority. In addition, an LLM should assess risk.

## Decision

- Proposals are automatically judged immediately after upload.
- Every file attached to a proposal is judged individually.
- Judgement uses extracted text via `FileScannerPort` / `@llamaindex/liteparse`
  plus metadata.
- Proposals are standalone objects with UUIDs.
- Multiple proposals can exist for the same skill ID.
- Proposals contain manifest, description, and files.
- The LLM judger evaluates proposals, skills, and files on defined
  dimensions through a replaceable judgement port.
- Judgement results are shown in admin.
- Judgement is provider-agnostic through a replaceable port; any provider can be
  wired via a `SkillJudgerPort` adapter implementation.

## Consequences

- Clear separation between submission and publication.
- More transparency and safety through judgements.
- Additional domain entity: `Judgement`.
- Additional outbound port: `SkillJudgerPort`.

## Open Points

- Concrete judgement dimensions and scoring logic are defined with the judger
  adapter.
