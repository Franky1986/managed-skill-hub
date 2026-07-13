# registry-bootstrap (deprecated standalone client)

This directory previously contained a standalone TypeScript reference client for agents.

## Current recommendation

Agents should consume the registry API **directly** using the contract from `GET /discover` and the OpenAPI specification at `GET /openapi.yaml`.

The canonical reference is now the published skill at `data/skills/registry-bootstrap/1.0.0/`, which contains:

- `README.md` – overview and agent workflow
- `WORKFLOW.md` – concrete step-by-step curl examples

## Why no standalone client?

A dedicated client adds an extra layer that can drift away from the actual API contract. Using the API directly keeps agents aligned with the source of truth and avoids confusion between frontend proxy URLs (`/api/*`) and backend root URLs.

## Legacy code

The TypeScript code in `src/` is kept for reference but is no longer the recommended integration path.
