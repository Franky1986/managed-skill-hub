# registry-bootstrap (deprecated standalone client)

This directory contains a retained, deprecated standalone TypeScript reference
client for agents. It is intentionally kept for compatibility experiments and
for demonstrating digest- and checksum-based local cache synchronization.

## Current recommendation

Agents should consume the registry API **directly** using the contract from `GET /discover` and the OpenAPI specification at `GET /openapi.yaml`.

The canonical reference is now the published `use-skill-hub` skill, which
agents obtain from `GET /discover.bootstrapSkill` and use together with the
live OpenAPI contract.

- `README.md` – overview and agent workflow
- `WORKFLOW.md` – concrete step-by-step curl examples

## Why no standalone client?

A dedicated client adds an extra layer that can drift away from the actual API contract. Using the API directly keeps agents aligned with the source of truth and avoids confusion between frontend proxy URLs (`/api/*`) and backend root URLs.

## Legacy code

The TypeScript code in `src/` is kept for reference but is no longer the
recommended integration path. It is not part of the API server runtime,
proposal upload flow, proposal/version diffs, projection updates, or ZIP
package downloads.

For direct file reads, the client passes the raw artifact path internally and
encodes it exactly once when constructing the HTTP URL. This supports nested
paths such as `agents/openai.yaml` and `scripts/build.sh`.

Do not remove this directory without first checking for downstream local users
of its `discover`, `pull`, or `sync` commands. Until then, keep its scope
limited to a consumer-side compatibility/reference artifact; new agent
guidance belongs in `use-skill-hub`, discovery, and OpenAPI instead.
