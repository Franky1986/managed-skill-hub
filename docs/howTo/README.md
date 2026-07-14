# How-To Index

This folder points agents and operators to task-oriented setup guides.

## Local Development

- Use `docs/setup/BUILD_AND_CHECKS.md` for dependency installation, local startup,
  checks, and build output.
- Use `docs/setup/TESTING.md` for API smoke tests, admin flows, and provider
  validation checks.

## Runtime Providers

- Use `docs/setup/ENVIRONMENT.md` for layered root `.env`/`.env.secrets`
  variables, SQLite/MySQL provider flags, judger settings, and auto-publish
  options.
- Use `docs/product/AGENT_OPERATIONS.md` for local runbooks covering SQLite,
  MySQL, mixed provider modes, judgers, and future provider boundaries.

## Authentication Profiles

- Use `.env.example.simple` for the local/simple profile.
- Use `docs/setup/AUTHENTIK.md` and `.env.example.authentik` for Authentik OIDC
  staging and the production activation gate.
- Use `.env.secrets.example` only to initialize the human-owned local secret
  file; agents should edit the non-secret profile instead.
- Use `docs/product/AGENT_OIDC_DEVICE_FLOW.md` for the runtime agent linkout,
  polling, token handling, and failure behavior.

## Judger Adapters

- Use `docs/setup/JUDGER_ADAPTERS.md` to add a Vercel AI SDK/OpenAI-backed
  judger or a custom adapter implementing `SkillJudgerPort`.

## Server Operation

- Use `docs/setup/DEPLOYMENT.md` for server layout, deployment archive flow,
  persistent `DATA_DIR`, and SQLite/MySQL server provider choices.
- Use `docs/setup/NGINX.md` for reverse proxy setup.
- Use `docs/setup/BACKUP_AND_RESTORE.md` for data backups and restores.
