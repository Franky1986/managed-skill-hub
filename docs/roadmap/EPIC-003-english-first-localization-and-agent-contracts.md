# EPIC-003: English-First Localization And Agent-Facing Contracts

## Goal

Make managed-skill-hub English-first across product, documentation, API contracts,
and agent-facing guidance, while keeping the web UI switchable between English
and German.

The registry is consumed by humans and by local coding agents. All canonical
instructions, contracts, specs, and public API guidance must therefore be stable
in English. When a user's local agent uses the registry endpoints, those
endpoints must still instruct the agent to communicate with the user in the
language the user is currently using, unless the user explicitly requests
another language.

## Current Problem

The project started with German-first internal wording. As the registry becomes
an agent-facing product, this creates three problems:

- Agent-facing contracts are harder to reuse across tools and teams.
- UI copy, API descriptions, docs, and specs can drift linguistically.
- A local agent may confuse the registry's canonical English contract language
  with the conversation language it should use with the user.

## Product Principles

1. English is the canonical product and contract language.
2. German is supported as a UI language, not as the canonical contract source.
3. Agent-facing instructions are always written in English.
4. Agent-facing instructions explicitly require agents to answer the user in
   the user's current language.
5. UI text is never hardcoded as one-off English or German strings once the
   localization layer exists.
6. Documentation and specs are updated in the same change as behavior, API, or
   UI copy changes.

## Scope

### Documentation

Migrate all repository documentation to English, including:

- `AGENTS.md`
- `README.md`
- `docs/index.md`
- `docs/roadmap/*`
- `docs/progress/*`
- `docs/architecture/*`
- `docs/decisions/*`
- `docs/setup/*`
- `docs/product/*`
- co-located `*.spec.md`
- legacy agent client documentation under `agents/registry-bootstrap/`

Documentation may describe German UI behavior, but the documentation itself is
English unless a future file is explicitly created as a translation artifact.

### Existing Skill Content And Metadata

Existing registered skill content is not part of the language migration.

Do not translate or rewrite:

- files inside existing skill versions, such as `SKILL.md`, `README.md`, or
  `WORKFLOW.md`
- existing skill titles
- existing skill descriptions
- existing tags, categories, capabilities, `useWhen`, or `doNotUseWhen`
- existing proposal content or uploaded files
- the already published `registry-bootstrap` skill content under `data/skills/`

Skills are content artifacts and may intentionally be written in any language.
Changing existing skill content or metadata would change digests, version
semantics, and SQLite projections, so it is outside this epic unless a separate
skill-specific change explicitly requests it.

### AGENTS.md Policy

`AGENTS.md` must define the repository language policy:

- Preferred interaction language for repository work: English unless the user
  writes in another language.
- Canonical docs, specs, OpenAPI descriptions, API guidance, and agent-facing
  instructions: English.
- UI: English default, German available through language selection.
- User-facing conversation rule for agents: respond in the language the user is
  currently using, unless the user asks otherwise.
- `AGENTS.md` itself must be fully rewritten in English, not just amended with
  an English policy section.

### API And OpenAPI

Keep public and admin API contracts English-only:

- OpenAPI operation summaries and descriptions
- schema descriptions and enum descriptions
- normalized error messages where the server returns human-readable guidance
- `GET /discover`
- `GET /howToPropose`
- public proposal status guidance
- agent-bootstrap workflow text

No German response variant is required for API endpoints in this epic.

Stable API error `code` values should be the primary frontend localization
anchor. Human-readable backend error text may remain English by default.

### Agent-Facing Guidance

All agent-facing guidance must be English and include the conversation-language
rule:

```text
When communicating with the user, use the language the user is currently using
unless the user explicitly asks for another language.
```

This applies at least to:

- `GET /discover` workflow notes
- `GET /howToPropose`
- `docs/product/AGENT_BOOTSTRAP.md`
- any future system-authored agent bootstrap, CLI, or sync instructions outside
  immutable existing skill content

For proposal submissions, the agent-facing guidance must also state that
proposal metadata should preferably be written in English:

- title
- description
- category
- tags
- capabilities
- `useWhen`
- `doNotUseWhen`

This is a recommendation for new proposal metadata, not a rule for uploaded
content files and not a migration requirement for existing skills.

### Web UI Localization

The web UI must support:

- English as the default language.
- German as a toggleable language.
- Language resolution in this order:
  1. explicit URL parameter, e.g. `?lang=de` or `?lang=en`
  2. saved user preference in `localStorage`
  3. browser language
  4. English fallback
- A visible language toggle in the app shell.
- Central message catalogs for English and German.
- A shared translation helper instead of inline bilingual conditionals for new
  copy.
- Localized API error presentation where the frontend maps stable server error
  codes to UI text.

The API remains English-only; frontend localization may translate the UI
presentation of known error codes.

The UI language must not be treated as the agent conversation language. Agents
must infer the conversation language from the current user interaction, not from
browser language, UI language, or API response language.

### User-Generated Text

User-generated and admin-generated text may be written in any language:

- proposal uploaded files
- proposal body/content
- admin review comments
- reject reasons
- deprecation reasons
- free-form notes

The system may recommend English for proposal metadata, but it must not reject
or rewrite user-generated text solely because it is not English.

### Audit And History

Existing audit/history entries must not be rewritten for translation.

New system-generated audit action names, reason labels, and history guidance
introduced by this epic should be English. Human-authored audit-adjacent text,
such as admin comments, remains free-form.

### UI Copy Migration

All existing visible UI copy must move into the localization layer, including:

- public layout and navigation
- home/search/detail pages
- How-to-propose page
- proposal status page
- admin login and dashboard
- admin skills and proposal workbench
- judgement, extraction, observability, and review labels
- validation and error states

German translations should be product-quality, not literal placeholders.

### Specs And Test Coverage

Specs must document the language behavior at the affected boundaries:

- app shell / router spec for language selection
- design spec for localized UI copy
- API client spec for localized error presentation
- `SkillReadController.spec.md` for English-only discover/how-to-propose output
- `ProposalController.spec.md` for English-only proposal guidance
- `AGENT_BOOTSTRAP.spec.md` for agent-facing language rules

Tests should cover:

- default language is English
- `?lang=de` selects German UI
- saved preference is reused
- browser German is honored when no URL/preference exists
- unknown language falls back to English
- core agent-facing endpoints contain English guidance and the user-language
  instruction

## Non-Scope

- German API responses.
- A full backend-driven i18n service.
- User accounts or server-side per-user language preferences.
- Translating generated technical identifiers, endpoint paths, enum values, or
  audit event names.
- Changing the domain model for multilingual skill content.

## Proposed Implementation Phases

### Phase 1: Language Policy And Agent Contracts

- Update `AGENTS.md` with the English-first policy.
- Rewrite `AGENTS.md` fully in English.
- Convert `README.md` and `docs/product/AGENT_BOOTSTRAP.md` to English.
- Do not translate existing skill content or metadata, including the already
  published `registry-bootstrap` skill content under `data/skills/`.
- Update `/discover` and `/howToPropose` text to English-only.
- Add the user-language instruction for agents.
- Add proposal-metadata guidance: metadata should preferably be English, while
  uploaded content may be in any language.
- Update OpenAPI descriptions and affected specs.

### Phase 2: Frontend Localization Foundation

- Add `apps/web/src/i18n/` or equivalent central localization module.
- Define `LanguageCode = 'en' | 'de'`.
- Add English and German message catalogs.
- Add language resolution from URL, `localStorage`, browser language, fallback.
- Add a language toggle to the app shell.
- Document behavior in `apps/web/src/router.spec.md` and
  `apps/web/src/design.spec.md`.

### Phase 3: UI Copy Migration

- Move all visible frontend copy into catalogs.
- Keep English catalog as canonical.
- Add German translations for all visible strings.
- Localize frontend-side validation and known API error-code presentation.
- Add focused tests for language resolution and representative pages.

### Phase 4: Documentation And Spec Migration

- Translate remaining docs, ADRs, roadmap/progress files, setup docs, and
  co-located specs to English.
- Keep file names stable unless a rename materially improves clarity.
- Update `docs/index.md` while migrating.
- Ensure progress docs remain accurate after translation.

### Phase 5: Remaining System Text And History Policy

- Convert new system-generated audit/history labels to English where they are
  defined in code.
- Leave existing audit/history data unchanged.
- Leave user-generated/admin-generated free-form text unrestricted.
- Search for German system copy outside UI German catalogs and accepted content
  artifacts.

### Phase 6: Verification And Cleanup

- Run `./scripts/check.sh`.
- Run frontend-focused tests and typecheck.
- Search for remaining German user-facing or agent-facing text.
- Classify any remaining German text as either:
  - intentional German UI translation catalog content, or
  - user-/admin-generated content,
  - existing skill content or metadata intentionally left untouched,
  - migration debt to fix before closing the epic.

## Acceptance Criteria

- `AGENTS.md` defines English-first repository policy.
- All canonical docs, specs, ADRs, roadmap files, setup docs, and product docs
  are written in English.
- `GET /discover` and `GET /howToPropose` return English agent-facing guidance.
- Agent-facing guidance tells agents to communicate with users in the user's
  current language unless asked otherwise.
- Proposal guidance recommends English metadata for new proposals while allowing
  uploaded content in any language.
- Existing skill content and metadata are not translated as part of this epic.
- User-generated and admin-generated free-form text may be in any language.
- Existing audit/history entries are not rewritten.
- Web UI defaults to English.
- Web UI can be switched to German.
- URL language selection, `localStorage` preference, browser language, and
  fallback order are implemented and tested.
- Existing visible UI copy is catalog-backed in English and German.
- OpenAPI descriptions are English.
- `./scripts/check.sh` passes.

## Search Checklist Before Closing

Run searches equivalent to:

```sh
rg -n -f /tmp/epic003-legacy-german-patterns.txt \
  AGENTS.md README.md docs apps packages agents data/skills
```

The pattern file should include legacy German and romanized-German terms that
previously appeared in docs and UI copy. Remaining matches must either be German
translation catalog entries or explicitly accepted content artifacts,
user-generated examples, or technical examples.

## Risks

- Large mechanical translation can hide behavior changes. Keep translation-only
  commits separate from behavior changes where possible.
- Existing tests may assert German copy. Update tests to assert stable behavior,
  message keys, or English canonical copy.
- Agent-facing endpoints must not become bilingual through implicit browser
  language handling; this epic intentionally keeps them English-only.
- UI localization must not move business logic into frontend copy helpers.
- Translating existing skill content or metadata would change content digests
  and version semantics. Keep that out of this epic.

## Definition Of Done

- The repository is English-first in docs, specs, OpenAPI, and agent-facing
  contracts.
- The UI is bilingual with English default and German toggle.
- Agent-facing endpoints consistently preserve the distinction between English
  contract language and the agent's obligation to answer users in their current
  language.
- Existing skill content, existing skill metadata, historical audit entries,
  and user-generated free-form text remain untouched unless a separate
  content-specific change requests it.
- Checks and relevant tests pass.
