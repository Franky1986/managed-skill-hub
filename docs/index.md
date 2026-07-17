# Documentation And Spec Index

This file is the central index for important project documentation and
co-located `*.spec.md` files.

## Getting Started For New Agents

1. [`README.md`](../README.md) - project overview, quickstart, stack
2. [`AGENTS.md`](../AGENTS.md) - rules for coding agents
3. [`docs/setup/BUILD_AND_CHECKS.md`](setup/BUILD_AND_CHECKS.md) - setup,
   checks, and local startup
4. [`docs/setup/TESTING.md`](setup/TESTING.md) - local testing and API checks
5. [`docs/setup/ENVIRONMENT.md`](setup/ENVIRONMENT.md) - root environment variables,
   SQLite/MySQL providers, judger settings, and auto-publish flags
6. [`docs/setup/AUTHENTIK.md`](setup/AUTHENTIK.md) - Authentik/OIDC runtime setup,
   cutover, and rollback
7. [`docs/setup/AUTHENTICATION_ACCEPTANCE_CHECKLIST.md`](setup/AUTHENTICATION_ACCEPTANCE_CHECKLIST.md) - executable auth-profile acceptance and result handoff
8. [`docs/setup/JUDGER_ADAPTERS.md`](setup/JUDGER_ADAPTERS.md) - built-in and custom judger adapters
9. [`docs/product/AGENT_OPERATIONS.md`](product/AGENT_OPERATIONS.md) - SQLite/MySQL,
   judger, and auto-publish runbooks
10. [`docs/product/AGENT_OIDC_DEVICE_FLOW.md`](product/AGENT_OIDC_DEVICE_FLOW.md) -
   target agent Device Authorization linkout contract
11. [`docs/setup/DEPLOYMENT.md`](setup/DEPLOYMENT.md) - server deployment
12. [`docs/howTo/README.md`](howTo/README.md) - task-oriented setup guide index
13. [`LICENSE`](../LICENSE) - project license
14. [`CONTRIBUTING.md`](../CONTRIBUTING.md) - contribution process
15. [`SECURITY.md`](../SECURITY.md) - security policy
16. [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) - collaboration standards

## Roadmap And Progress

| Document | Purpose |
|----------|---------|
| [docs/roadmap/MASTER_PLAN.md](roadmap/MASTER_PLAN.md) | Vision, epics, dependencies |
| [docs/roadmap/EPIC-001-mvp.md](roadmap/EPIC-001-mvp.md) | MVP work packages and acceptance criteria |
| [docs/roadmap/EPIC-002-agent-workbench-ui.md](roadmap/EPIC-002-agent-workbench-ui.md) | Agent workbench, viewer, sync metadata, and review hardening |
| [docs/roadmap/EPIC-002-STATUS.md](roadmap/EPIC-002-STATUS.md) | Implemented state, open items, and EPIC-002 prioritization |
| [docs/roadmap/EPIC-003-english-first-localization-and-agent-contracts.md](roadmap/EPIC-003-english-first-localization-and-agent-contracts.md) | English-first documentation, agent-facing contracts, and bilingual UI localization |
| [docs/roadmap/EPIC-007-configurable-agent-api-auth.md](roadmap/EPIC-007-configurable-agent-api-auth.md) | Implemented configurable bearer auth for agent read/proposal/discovery APIs |
| [docs/roadmap/EPIC-008-deterministic-validation-and-release-proofing.md](roadmap/EPIC-008-deterministic-validation-and-release-proofing.md) | Implemented deterministic validation scripts and proof artifacts for release confidence |
| [docs/roadmap/EPIC-009-database-backed-content-storage.md](roadmap/EPIC-009-database-backed-content-storage.md) | Planned database-backed content storage |
| [docs/roadmap/EPIC-010-portable-agent-command-artifacts.md](roadmap/EPIC-010-portable-agent-command-artifacts.md) | Planned portable command artifacts for Cursor, Codex, Claude Code, and generic agent runtimes |
| [docs/roadmap/EPIC-011-authentik-oidc-and-delegated-agent-authentication.md](roadmap/EPIC-011-authentik-oidc-and-delegated-agent-authentication.md) | Implemented Authentik runtime and remaining real-staging production activation gate |
| [docs/progress/CURRENT_STATUS.md](progress/CURRENT_STATUS.md) | Current project state |
| [docs/progress/NEXT_STEPS.md](progress/NEXT_STEPS.md) | Concrete next steps |
| [docs/progress/CHANGELOG_INTERNAL.md](progress/CHANGELOG_INTERNAL.md) | Engineering change journal |

## Architecture And Decisions

| Document | Purpose |
|----------|---------|
| [docs/architecture/SYSTEM_OVERVIEW.md](architecture/SYSTEM_OVERVIEW.md) | Architecture overview |
| [docs/architecture/SKILL_ID_RULES.md](architecture/SKILL_ID_RULES.md) | Skill ID rules |
| [docs/architecture/GROUPS.md](architecture/GROUPS.md) | Group concept |
| [docs/architecture/SUPPORTED_FILE_TYPES.md](architecture/SUPPORTED_FILE_TYPES.md) | Supported file types |
| [docs/decisions/ADR-001-architecture-and-stack.md](decisions/ADR-001-architecture-and-stack.md) | Architecture and stack |
| [docs/decisions/ADR-002-spec-driven-development.md](decisions/ADR-002-spec-driven-development.md) | Spec-driven development |
| [docs/decisions/ADR-003-simple-admin-auth.md](decisions/ADR-003-simple-admin-auth.md) | Simple admin auth in the MVP |
| [docs/decisions/ADR-004-deployment-and-backup.md](decisions/ADR-004-deployment-and-backup.md) | Deployment and backup |
| [docs/decisions/ADR-005-filebased-storage.md](decisions/ADR-005-filebased-storage.md) | File-based source of truth |
| [docs/decisions/ADR-006-proposals-and-judgements.md](decisions/ADR-006-proposals-and-judgements.md) | Proposals and judgements |
| [docs/decisions/ADR-007-no-namespace-groups.md](decisions/ADR-007-no-namespace-groups.md) | No namespace, groups instead |
| [docs/decisions/ADR-008-search-strategy.md](decisions/ADR-008-search-strategy.md) | Search strategy |
| [docs/decisions/ADR-009-llm-judger-port.md](decisions/ADR-009-llm-judger-port.md) | LLM judger as a port |
| [docs/decisions/ADR-010-large-file-upload.md](decisions/ADR-010-large-file-upload.md) | Large files through local agent preflight |
| [docs/decisions/ADR-011-skill-id-rules.md](decisions/ADR-011-skill-id-rules.md) | Skill ID rules |
| [docs/decisions/ADR-012-content-extraction-strategy.md](decisions/ADR-012-content-extraction-strategy.md) | Content extraction strategy |
| [docs/decisions/ADR-013-sqlite-metadata-truth.md](decisions/ADR-013-sqlite-metadata-truth.md) | SQLite as metadata truth |
| [docs/decisions/ADR-014-database-backed-content-storage.md](decisions/ADR-014-database-backed-content-storage.md) | Configurable database-backed managed content storage |
| [docs/decisions/ADR-015-authentik-oidc-and-delegated-agent-identity.md](decisions/ADR-015-authentik-oidc-and-delegated-agent-identity.md) | Implemented Authentik OIDC and human-delegated agent identity decision |

## Setup And Operations

| Document | Purpose |
|----------|---------|
| [docs/setup/BUILD_AND_CHECKS.md](setup/BUILD_AND_CHECKS.md) | Build, checks, local startup |
| [docs/setup/TESTING.md](setup/TESTING.md) | Local testing and API checks |
| [docs/setup/ENVIRONMENT.md](setup/ENVIRONMENT.md) | Environment variables |
| [docs/setup/AUTHENTIK.md](setup/AUTHENTIK.md) | Authentik OIDC operator setup, real-staging gate, cutover, and rollback playbook |
| [docs/setup/AUTHENTICATION_ACCEPTANCE_CHECKLIST.md](setup/AUTHENTICATION_ACCEPTANCE_CHECKLIST.md) | Manual and automated acceptance scenarios for simple, bearer, OIDC, mixed, and rollback auth profiles |
| [docs/setup/JUDGER_ADAPTERS.md](setup/JUDGER_ADAPTERS.md) | Judger adapter contract and extension |
| [docs/setup/DEPLOYMENT.md](setup/DEPLOYMENT.md) | Server deployment |
| [docs/setup/BACKUP_AND_RESTORE.md](setup/BACKUP_AND_RESTORE.md) | Backup and restore |
| [docs/setup/NPM_VERIFICATION.md](setup/NPM_VERIFICATION.md) | NPM package verification and vulnerabilities |
| [docs/setup/DEPENDENCY_UPDATE_LOG.md](setup/DEPENDENCY_UPDATE_LOG.md) | Dependency update log |
| [docs/setup/NGINX.md](setup/NGINX.md) | Example nginx configuration |
| [scripts/README.md](../scripts/README.md) | Script ownership, stable entrypoints, and deployment blueprint |

## Scripts

| Script | Purpose |
|--------|---------|
| [.github/workflows/validation.yml](../.github/workflows/validation.yml) | CI split for lightweight proof artifacts and scheduled/manual MySQL full validation |
| [scripts/check.sh](../scripts/check.sh) | Structure checks, lint, typecheck, tests |
| [scripts/checks/check-agent-auth-matrix.ts](../scripts/checks/check-agent-auth-matrix.ts) | Deterministic auth permutation proof with `.tmp` artifacts |
| [scripts/content/migrate-env-layout.ts](../scripts/content/migrate-env-layout.ts) | Value-redacting migration from mixed `.env` to layered `.env`/`.env.secrets` |
| [scripts/checks/check-judger-autopublish-matrix.ts](../scripts/checks/check-judger-autopublish-matrix.ts) | Deterministic judger and auto-publish safety proof |
| [scripts/full-check.sh](../scripts/full-check.sh) | Extended EPIC-008 validation entrypoint with optional smoke/MySQL gates |
| [scripts/checks/check-public-release-hygiene.sh](../scripts/checks/check-public-release-hygiene.sh) | Public release hygiene proof for metadata, secrets, private files, and history |
| [scripts/checks/check-openapi-parity.ts](../scripts/checks/check-openapi-parity.ts) | Deterministic OpenAPI parity proof for agent-facing routes |
| [scripts/checks/check-provider-matrix.ts](../scripts/checks/check-provider-matrix.ts) | Deterministic provider parity proof for SQLite and optional MySQL combinations |
| [scripts/checks/check-content-storage-matrix.ts](../scripts/checks/check-content-storage-matrix.ts) | Deterministic filesystem versus database content-storage parity proof |
| [scripts/checks/check-content-migration.ts](../scripts/checks/check-content-migration.ts) | Deterministic filesystem-to-database content migration proof |
| [scripts/checks/check-content-export.ts](../scripts/checks/check-content-export.ts) | Deterministic database-to-filesystem content export proof |
| [scripts/checks/check-provider-cutover.ts](../scripts/checks/check-provider-cutover.ts) | Deterministic SQLite-to-MySQL provider cutover proof |
| [scripts/checks/check-skill-package-downloads.ts](../scripts/checks/check-skill-package-downloads.ts) | Deterministic published skill package download proof |
| [scripts/checks/check-proposal-lifecycle.ts](../scripts/checks/check-proposal-lifecycle.ts) | Deterministic proposal lifecycle proof |
| [scripts/checks/check-observability-audit.ts](../scripts/checks/check-observability-audit.ts) | Deterministic observability export and audit evidence proof |
| [scripts/checks/check-backup-restore.ts](../scripts/checks/check-backup-restore.ts) | Deterministic backup and restore proof with isolated data |
| [scripts/checks/check-concurrency-abuse.ts](../scripts/checks/check-concurrency-abuse.ts) | Deterministic proposal state and unsafe path abuse proof |
| [scripts/checks/check-agent-contract.ts](../scripts/checks/check-agent-contract.ts) | Deterministic discovery/how-to/setup-script contract proof |
| [scripts/checks/check-admin-ui-smoke.ts](../scripts/checks/check-admin-ui-smoke.ts) | Lightweight admin/public UI source-contract smoke proof |
| [scripts/development/smoke-test.sh](../scripts/development/smoke-test.sh) | Automated local API smoke tests |
| [scripts/deployment/create-deploy-archive.sh](../scripts/deployment/create-deploy-archive.sh) | Create a deployment archive from committed files |
| [scripts/deployment/prepare-release.sh](../scripts/deployment/prepare-release.sh) | Create generic public deployment artifacts |
| [scripts/deployment/upload.sh](../scripts/deployment/upload.sh) | Upload explicit artifacts through an operator-owned target profile |
| [scripts/deployment/service.sh](../scripts/deployment/service.sh) | Generic deployment-root runtime controller |
| [scripts/checks/check-deployment-blueprint.sh](../scripts/checks/check-deployment-blueprint.sh) | Deterministic generic deployment blueprint proof |
| [scripts/deployment/install_and_start.sh](../scripts/deployment/install_and_start.sh) | Install and start on the server |
| [scripts/deployment/restart-server.sh](../scripts/deployment/restart-server.sh) | Restart/stop stack |
| [scripts/operations/backup.sh](../scripts/operations/backup.sh) | Create backup |
| [data/skills/registry-bootstrap/1.0.0/](../data/skills/registry-bootstrap/1.0.0/) | Published reference skill for agents; existing skill content is intentionally not translated by EPIC-003 |
| [agents/registry-bootstrap/README.md](../agents/registry-bootstrap/README.md) | Legacy reference client; no longer recommended |
| [scripts/operations/restore.sh](../scripts/operations/restore.sh) | Restore backup |

## Domain And Application Specs

| Spec | Purpose |
|------|---------|
| [apps/api/src/domain/skill/Skill.spec.md](../apps/api/src/domain/skill/Skill.spec.md) | Skill entity |
| [apps/api/src/domain/skill/SkillVersion.spec.md](../apps/api/src/domain/skill/SkillVersion.spec.md) | SkillVersion entity |
| [apps/api/src/domain/proposal/Proposal.spec.md](../apps/api/src/domain/proposal/Proposal.spec.md) | Proposal entity |
| [apps/api/src/domain/judgement/Judgement.spec.md](../apps/api/src/domain/judgement/Judgement.spec.md) | Judgement entity |

## Port Specs

| Spec | Purpose |
|------|---------|
| [apps/api/src/application/ports/inbound/SkillQueryPort.spec.md](../apps/api/src/application/ports/inbound/SkillQueryPort.spec.md) | Public read path |
| [apps/api/src/application/ports/inbound/SkillCommandPort.spec.md](../apps/api/src/application/ports/inbound/SkillCommandPort.spec.md) | Admin write path |
| [apps/api/src/application/ports/inbound/ProposalCommandPort.spec.md](../apps/api/src/application/ports/inbound/ProposalCommandPort.spec.md) | Proposal path |
| [apps/api/src/application/ports/inbound/SkillNameSuggestionPort.spec.md](../apps/api/src/application/ports/inbound/SkillNameSuggestionPort.spec.md) | Name suggestion |
| [apps/api/src/application/ports/outbound/SkillRepositoryPort.spec.md](../apps/api/src/application/ports/outbound/SkillRepositoryPort.spec.md) | Skill persistence |
| [apps/api/src/application/ports/outbound/SkillFileStoragePort.spec.md](../apps/api/src/application/ports/outbound/SkillFileStoragePort.spec.md) | File storage |
| [apps/api/src/application/ports/outbound/SkillSearchPort.spec.md](../apps/api/src/application/ports/outbound/SkillSearchPort.spec.md) | Search |
| [apps/api/src/application/ports/outbound/AuditLogPort.spec.md](../apps/api/src/application/ports/outbound/AuditLogPort.spec.md) | Audit log |
| [apps/api/src/application/ports/outbound/SkillJudgerPort.spec.md](../apps/api/src/application/ports/outbound/SkillJudgerPort.spec.md) | LLM judger port |
| [apps/api/src/application/ports/outbound/FileScannerPort.spec.md](../apps/api/src/application/ports/outbound/FileScannerPort.spec.md) | File scanner port |

## Adapter Specs

| Spec | Purpose |
|------|---------|
| [apps/api/src/adapters/inbound/http/SkillReadController.spec.md](../apps/api/src/adapters/inbound/http/SkillReadController.spec.md) | Public HTTP API |
| [apps/api/src/adapters/inbound/http/AdminSkillController.spec.md](../apps/api/src/adapters/inbound/http/AdminSkillController.spec.md) | Admin HTTP API |
| [apps/api/src/adapters/inbound/http/ProposalController.spec.md](../apps/api/src/adapters/inbound/http/ProposalController.spec.md) | Proposal HTTP API |
| [apps/api/src/adapters/inbound/http/JudgementController.spec.md](../apps/api/src/adapters/inbound/http/JudgementController.spec.md) | Judgement HTTP API |
| [apps/api/src/adapters/inbound/http/HealthcheckController.spec.md](../apps/api/src/adapters/inbound/http/HealthcheckController.spec.md) | Healthchecks |
| [apps/api/src/adapters/inbound/http/SimpleAdminAuth.spec.md](../apps/api/src/adapters/inbound/http/SimpleAdminAuth.spec.md) | Admin auth |
| [apps/api/src/adapters/inbound/http/SkillNameSuggestionController.spec.md](../apps/api/src/adapters/inbound/http/SkillNameSuggestionController.spec.md) | Name suggestion API |
| [apps/api/src/adapters/outbound/persistence/filesystem/FileSystemSkillRepository.spec.md](../apps/api/src/adapters/outbound/persistence/filesystem/FileSystemSkillRepository.spec.md) | FileSystem repository |
| [apps/api/src/adapters/outbound/audit/filesystem/FileSystemAuditLog.spec.md](../apps/api/src/adapters/outbound/audit/filesystem/FileSystemAuditLog.spec.md) | FileSystem audit |
| [apps/api/src/adapters/outbound/search/sqlite/SqliteSkillSearch.spec.md](../apps/api/src/adapters/outbound/search/sqlite/SqliteSkillSearch.spec.md) | SQLite search |

## Quick Spec Search

```sh
rg --files | rg '\.spec\.md$'
```

## Product Documentation

| Document | Purpose |
|----------|---------|
| [docs/product/FRONTEND_DESIGN_BRIEF.md](product/FRONTEND_DESIGN_BRIEF.md) | Frontend design brief |
| [docs/product/DESIGN_AGENT_BRIEF.md](product/DESIGN_AGENT_BRIEF.md) | Handoff document for design agents |
| [docs/product/AGENT_BOOTSTRAP.md](product/AGENT_BOOTSTRAP.md) | How agents bootstrap without the UI |
| [docs/product/AGENT_OPERATIONS.md](product/AGENT_OPERATIONS.md) | Local provider modes, auto-publish options, and agent operation guidance |
| [docs/product/AGENT_OIDC_DEVICE_FLOW.md](product/AGENT_OIDC_DEVICE_FLOW.md) | Runtime Device Authorization linkout and token-handling guidance for agents |
