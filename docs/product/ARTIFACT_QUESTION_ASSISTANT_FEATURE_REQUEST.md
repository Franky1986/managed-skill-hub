# Feature Request: Grounded Artifact Question Assistant

## Status

**Deferred / explicitly out of the current implementation scope.**

This document records the product and architecture findings for a future admin
feature. It does not authorize a chat endpoint, a model provider, persistent
conversation storage, or any UI change in the current release.

## Problem

An admin reviewing a proposal or a skill version may need an answer that spans
metadata, many files, a version diff, and existing judgements. Reading every
file manually is slow, while sending an entire package blindly to a model is
unbounded, expensive, and unsafe.

The future feature should let an authorized admin ask a question about one
fixed proposal or one fixed skill version and receive a grounded answer with
verifiable sources.

## Intended User Experience

The admin workbench may expose **Ask about this proposal/version** with:

- a question field;
- an explicit scope: complete proposal/version, changed files only, or files
  selected by the admin;
- for proposal review, an optional comparison against the selected reference
  version;
- visible progress such as `Selecting relevant files` and `Using 4 of 27
  files`;
- an answer with citations that open the corresponding file and section in the
  existing admin viewer;
- an explicit uncertainty result when the available artifacts do not support a
  reliable answer.

The initial delivery should be a single grounded question and answer, not a
general persistent chat product.

## Retrieval And Context Strategy

1. Bind the request server-side to a proposal ID or to a skill ID plus an exact
   version. The client must not supply arbitrary storage paths.
2. Load compact deterministic context first: manifest/tree, metadata, status,
   selected reference version, manifest diff, and relevant judgement summaries.
3. Retrieve relevant file content from persisted extracts. Prefer a lexical
   retrieval pass over extracted chunks, then select bounded chunks from the
   best matching files.
4. Include raw content only where it is safe, text-based, and required; binary
   content is represented by safe metadata and extraction availability.
5. Enforce configured file-count, chunk-count, character/token, timeout, and
   concurrency limits before the provider call.
6. Return the cited paths and stable section/line ranges with the answer. An
   answer must not claim support from a file that was not included in its
   context.

For large packages, retrieval is mandatory. A full-package prompt is not an
acceptable fallback. If no extract can support the question, the response must
say so and identify the missing or non-extractable evidence.

## Proposed Architecture

Keep this separate from `SkillJudgerPort`. Judgement evaluates a defined risk
contract; question answering is an interactive, evidence-grounded read use
case.

Suggested boundaries:

- `ArtifactRetrievalPort`: returns ranked, bounded extracted chunks and their
  citation metadata for a fixed proposal or skill version.
- `ArtifactQuestionAnswerPort`: calls a configured answer model with already
  bounded context and returns structured answer text, uncertainty, and cited
  chunk IDs.
- `AnswerArtifactQuestionUseCase`: authorizes the target, loads deterministic
  context, invokes retrieval, validates citations, records safe audit metadata,
  and returns the result or starts an operation.
- An inbound admin controller and OpenAPI contract, protected by the same
  reviewer/publisher access boundary as artifact inspection.

Existing extracted-content storage is the input source. A later implementation
may add a provider-neutral persisted chunk index to SQLite/MySQL; it must not
place retrieval-provider details in Domain code.

## Operations And Responsiveness

Model work can exceed normal browser request budgets. The feature should reuse
the durable asynchronous-operation pattern already used for long-running
review work:

- create an `answer_artifact_question` operation;
- report retrieval and generation progress without exposing raw provider
  diagnostics;
- support polling and cancellation where the provider permits it;
- retain a safe terminal error category rather than a provider error payload.

## Security And Privacy Requirements

- Admin-only authorization, with server-side target/version validation.
- Treat every artifact, including instructions found in `SKILL.md`, as
  untrusted data. Artifact text cannot alter system instructions, request tools,
  disclose credentials, or cause writes.
- The answer path is read-only: it cannot approve, publish, reject, modify
  files, call arbitrary URLs, or invoke agent tools.
- Keep provider configuration, model identity, timeout, retry, and concurrency
  separate from the judgement configuration.
- Do not persist full questions or answers by default. Audit only the actor,
  target, operation state, provider identity, and safe error category. A future
  explicit `Save as review note` action may persist a chosen answer separately.
- Do not expose raw storage, provider, or extraction errors to the UI.

## Acceptance Criteria For A Future Delivery

- An admin can ask a question about exactly one proposal or one skill version.
- The response lists the files/sections used and every factual answer has
  citations.
- Changed-files-only scope does not retrieve unchanged files unless the admin
  explicitly broadens the scope.
- A package with many files uses bounded retrieval rather than a whole-package
  prompt.
- Missing, binary, or non-extractable evidence produces transparent uncertainty.
- Prompt-injection text in an artifact cannot change the answerer contract or
  trigger side effects.
- SQLite and MySQL implementations provide equivalent retrieval behavior.
- OpenAPI, co-located specs, provider tests, authorization tests, and operation
  progress tests cover the boundary.

## Deliberately Deferred Decisions

- Provider/model selection and whether a local model is supported.
- Lexical-only retrieval versus optional vector retrieval.
- Chunking format, index schema, retention duration, and re-indexing policy.
- Conversation history, answer sharing, and explicit review-note persistence.
- Cost quotas, rate limits, and per-role usage controls.
