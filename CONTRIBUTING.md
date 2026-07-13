# Contributing

Thanks for your interest in ManagedSkillHub.

## Development Setup

From repository root:

```bash
npm install --legacy-peer-deps
npm run check
```

Use workspaces for local loops:

```bash
npm run dev                    # run api + web
./scripts/check.sh              # lint + typecheck + tests
npm run build:prod              # production build
```

## Working Conventions

- Keep changes minimal and scoped.
- Update tests for behavioral changes where appropriate.
- Keep sensitive runtime data out of commits (`.env`, `data/`, logs, secrets).
- Keep docs and status docs in sync with implementation changes.
- Follow `AGENTS.md` and repository rules (English for agent-facing docs,
  openapi-first, and spec-driven changes).
