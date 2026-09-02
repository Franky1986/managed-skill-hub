# Spec: AdminOperationController (HTTP Adapter)

## Purpose

Provides authorized administrative reads of durable asynchronous-operation
progress without exposing worker payloads or requester identity.

## Route

- `GET /admin/operations/:operationId`

## Contract

- Reviewers, publishers, and administrators may read an operation.
- Missing operations return `404` through the standard admin error mapping.
- Responses use the documented operation projection only. `payload`,
  `requestedBy`, and `dedupeKey` are persistence details and never leave the
  server.

## Tests

- Unauthorized request returns `401`.
- Authorized request returns the redacted projection.
- Missing operation returns `404`.
