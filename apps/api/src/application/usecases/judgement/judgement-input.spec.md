# Spec: Canonical Judgement Input

## Purpose

Defines the provider-neutral, deterministic input contract used to decide
whether an existing judgement can be reused.

## Contract

- Global targets serialize skill/proposal metadata and sorted file descriptors;
  the target ID is not part of the fingerprint.
- File targets include the extracted text, MIME type, size, checksum, and
  extractor identity.
- A fingerprint covers canonical title, text, metadata, model, prompt version,
  and configured reuse scope.
- Reuse requires an equal fingerprint, prompt version, model, and a real
  provider model (never `noop`). Reused results are cloned with the new target
  type and ID.
- Any changed metadata, descriptor, file text, model, scope, prompt version,
  or legacy context text requires a new provider call.

## Safety

The module contains no provider configuration or provider-specific values.
Callers must not inject audit-only context metadata into canonical input.

## Tests

- `judgement-input.test.ts`
- conversion reuse coverage in `judge-skill-version.usecase.test.ts`
