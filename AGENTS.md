# AGENTS.md

## Project Goal

Build a self-hosted skill registry for AI agents. Product managers and developers
manage, version, review, and publish skills; agents consume published skills
through a stable API.

## Language Policy

- Canonical repository language is English.
- Agent-facing instructions, API guidance, OpenAPI descriptions, docs, ADRs,
  roadmap files, progress files, and co-located `*.spec.md` files must be
  written in English.
- The web UI defaults to English and may offer German through the UI language
  toggle.
- When communicating with the user, use the language the user is currently
  using unless the user explicitly asks for another language.
- Existing skill content, existing skill metadata, uploaded proposal content,
  and human-written admin comments may be in any language and must not be
  translated unless a task explicitly asks for that content change.
- New proposal metadata should preferably be written in English, but uploaded
  content files may be in any language.

## Architecture Defaults

- **Hexagonal Architecture**: Domain, Application, Ports, and Adapters are kept
  clearly separated.
- **Domain-Driven Design**: Domain terms and invariants belong in the Domain
  layer.
- **OpenAPI-first**: The OpenAPI specification is the central contract between
  backend, frontend, CLI, and agents.
- **Spec-Driven Development**: Every non-trivial boundary, use case, interface,
  and adapter is documented as a co-located `*.spec.md`.
- **Tests** and **observability** are first-class project concerns.

## Required Reading Before Changes

1. [`docs/roadmap/MASTER_PLAN.md`](./docs/roadmap/MASTER_PLAN.md)
2. [`docs/architecture/SYSTEM_OVERVIEW.md`](./docs/architecture/SYSTEM_OVERVIEW.md)
3. Relevant ADRs under [`docs/decisions/`](./docs/decisions/)
4. Relevant co-located `*.spec.md` files for the boundary being changed
5. [`docs/product/AGENT_OPERATIONS.md`](./docs/product/AGENT_OPERATIONS.md) for local provider/auto-publish operation modes when testing with agents

For a fresh checkout, or whenever `.env` and `.env.secrets` are missing, start with:

```bash
./install_dev.sh
```

This wrapper prepares local defaults, prompts for a local admin password if needed,
and starts the full development stack through
`./scripts/development/restart-all.sh`.

For setup, provider, deployment, or judger-adapter work, also read:

1. [`docs/setup/ENVIRONMENT.md`](./docs/setup/ENVIRONMENT.md)
2. [`docs/setup/JUDGER_ADAPTERS.md`](./docs/setup/JUDGER_ADAPTERS.md)
3. [`docs/setup/DEPLOYMENT.md`](./docs/setup/DEPLOYMENT.md)
4. [`docs/product/AGENT_OPERATIONS.md`](./docs/product/AGENT_OPERATIONS.md)

For language and localization work, also read:

1. [`docs/roadmap/EPIC-003-english-first-localization-and-agent-contracts.md`](./docs/roadmap/EPIC-003-english-first-localization-and-agent-contracts.md)

## Build And Check Path

```bash
./scripts/check.sh
```

## Progress Documents To Update After Changes

- [`docs/progress/CURRENT_STATUS.md`](./docs/progress/CURRENT_STATUS.md) - when
  the actual project state changes
- [`docs/progress/NEXT_STEPS.md`](./docs/progress/NEXT_STEPS.md) - when the next
  tasks shift
- [`docs/progress/CHANGELOG_INTERNAL.md`](./docs/progress/CHANGELOG_INTERNAL.md)
  - short journal of decisions and changes
- Co-located `*.spec.md` files - for any material change to behavior,
  contracts, inputs/outputs, guardrails, or checks

## Agent Guardrails

- Do not put business logic in UI components, controllers, or database adapters.
- Do not access the filesystem directly outside storage adapters.
- Do not put SQLite-specific or search-specific logic in Domain or Use Cases.
- Only serve `published` skills through the public read path.
- Never delete `data/` in deployment scripts.
- Do not translate existing skill content or metadata as part of English-first
  repository cleanup. Skill changes affect digests, versions, and SQLite
  projections and require an explicit skill-specific task.
