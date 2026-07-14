# Spec: AdminSkillController (HTTP Adapter)

## Purpose

HTTP adapter for protected admin operations.

## Scope

- `GET /admin/skills`
- `GET /admin/skills/:id`
- `GET /admin/skills/:id/files`
- `GET /admin/skills/:id/files/:fileId`
- `PATCH /admin/skills/:id/files/:fileId`
- `DELETE /admin/skills/:id/files/:fileId`
- `PUT /admin/skills/:id/files/:fileId/content`
- `GET /admin/skills/:id/files/:fileId/extracted-content`
- `POST /admin/skills`
- `PATCH /admin/skills/:id`
- `POST /admin/skills/:id/files`
- `POST /admin/skills/:id/submit-review`
- `POST /admin/skills/:id/approve`
- `POST /admin/skills/:id/publish`
- `POST /admin/skills/:id/deprecate`, optionally with reason
- `POST /admin/skills/:id/files/:fileId/re-extract`
- `POST /admin/skills/:id/versions/:version/re-judge`
- `POST /admin/search/reindex`
- `POST /admin/projections/rebuild`

## Non-Scope

- Public read operations
- Authentication logic; handled by middleware

## Responsibilities

- Ensure auth guards.
- Follow OpenAPI contract.
- Forward commands to `SkillCommandPort`.
- Forward an optional judgement override reason and authorize it only for the
  `admin` role; publisher-only sessions cannot bypass a required gate.
- Trigger admin-side reruns without executing skill code.
- Make unpublished skill versions and their files readable.
- Treat file uploads as new draft versions instead of in-place mutation.
- Treat file move/rename/delete as new draft versions instead of in-place
  mutation.
- Treat text-based file content updates as new draft versions instead of
  in-place mutation.
- Return errors through normalized JSON contract with `error`, `code`,
  `requestId`.
- For internal admin errors, additionally expose technical original message for
  debugging.
- Serve admin skill list/detail preferably from SQLite catalog projection.
- Build admin skill aggregates for internal read helpers directly from SQLite
  catalog projection when available.
- Serve admin file metadata lists and version resolution for raw file reads
  preferably from SQLite catalog projection; raw and extract contents still come
  from storage/extractor.
- Delegate admin `Extracted Content` for unpublished or published skill versions
  through SQLite-based version resolution to extractor.
- Do not trigger additional repository pre-rehydration before catalog-backed
  admin `Extracted Content` reads.

## Inputs / Outputs

- Inputs: HTTP request with admin session
- Outputs: HTTP response

## Dependencies / Ports

- `SkillCommandPort`

## Failure Modes

- Unauthenticated -> `401`
- Unauthorized -> `403`
- Invalid status transition -> `409`
- Missing required publication judgements -> `409 JUDGEMENT_REQUIRED`
- Validation error -> `422`
- Missing file/version -> `404`
- Error responses contain at least `error`, `code`, `requestId`
- Unexpected admin errors may additionally contain `originalError`

## Acceptance Criteria

- Only authenticated admins can execute admin operations.
- Deprecate accepts an optional public reason.
- Publish accepts an optional administrator-only, audited judgement override
  reason.
- Skill file mutations never perform in-place changes to existing versions.
- Endpoints match OpenAPI spec.

## Tests / Checks

- HTTP integration tests with mocked auth
- OpenAPI contract tests

## Agent Guardrails

- No auth decisions in controller code.
- No business logic in controller.
