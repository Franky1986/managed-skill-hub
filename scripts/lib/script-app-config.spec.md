# Script App Config Spec

## Purpose

Provide one type-safe baseline `AppConfig` for deterministic root-level proof
scripts.

## Contract

- `createScriptAppConfig()` returns a complete `AppConfig`.
- Callers override only values relevant to their proof.
- Safe local defaults use loopback networking, open agent-facing routes, simple
  admin authentication, SQLite providers, filesystem content storage, and the
  noop judger.
- The helper does not read `.env` or `.env.secrets`.
- Adding a required `AppConfig` field must fail the root-script TypeScript
  check until the shared fixture is updated.

## Checks

- `npx tsc -p scripts/tsconfig.json`
- `./scripts/check.sh`
