# Spec: OperationCommandPort

## Purpose

Provides application commands for starting and reading durable administrative
operations without exposing storage or worker implementation details to HTTP
adapters.

## Contract

- `start` persists or reuses a durable operation for a supported operation kind.
- `get` returns an operation by id or `null` when it does not exist.
- Inputs identify the protected proposal, skill version, or file target and the
  requesting actor; payload is internal worker input and must not be serialized
  by inbound adapters.

## Guardrails

- Callers must not execute long-running work inline after `start`.
- HTTP responses use a dedicated redacted projection rather than `OperationRecord`.
