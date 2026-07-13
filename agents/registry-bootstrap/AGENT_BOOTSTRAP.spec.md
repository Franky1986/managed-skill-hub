# Spec: Agent Registry Bootstrap

## Purpose

Reference client and skill that demonstrate how an autonomous agent can consume the managed-skill-hub public API, detect changes without executing skill code, and pull only modified artifacts to a local cache.

## Scope

- Read discovery endpoint and category list.
- List and search published skills.
- Compare `skillUuid`, `versionUuid` and `contentDigest` per skill.
- Compare `sha256` per artifact.
- Download changed artifacts only.
- Maintain local sync state across runs.

## Non-Scope

- Admin operations.
- Skill execution on the registry host.
- Writing to the registry.
- Semantic search.

## Responsibilities

- Use only the unauthenticated public read API (`/discover`, `/categories`, `/skills`, `/skills/search`, `/skills/:id/files`, `/skills/:id/files/:fileId`).
- Decide whether a skill needs re-pulling by comparing skill-level UUIDs and digest with the last local sync state.
- Decide whether an individual file needs re-downloading by comparing `sha256` with the last local sync state.
- Never execute downloaded skill files.
- Persist sync state in a local JSON file.
- Provide both a TypeScript client and a self-contained shell script for different agent environments.

## Inputs / Outputs

- Inputs: `REGISTRY_URL`, optional `REGISTRY_OUTPUT_DIR`, optional `REGISTRY_STATE_FILE`.
- Outputs: local skill directory tree and `.state.json` sync state.

## Failure Modes

- Registry unreachable → error message and exit code 1.
- Invalid skill/file id → HTTP 404 surfaced as error.
- Local checksum mismatch → warning printed, file still kept locally.

## Acceptance Criteria

- `discover` prints registry metadata and categories.
- `list` prints published skills with UUIDs and digests.
- `search` returns results for keyword/fulltext/regex queries.
- `pull <skillId>` downloads all files of the latest published version.
- `sync` skips skills and files whose metadata/checksums match the local state.
- `./scripts/check.sh` remains successful (the client is not part of the workspace build, but TypeScript compiles via `npx tsc -p agents/registry-bootstrap/tsconfig.json --noEmit`).

## Tests / Checks

- Manual local runtime test against `npm run dev` (cannot run in sandbox because tsx IPC socket is blocked).
- TypeScript compilation check.

## Agent Guardrails

- No business logic that belongs in the registry.
- No execution of downloaded skill scripts.
