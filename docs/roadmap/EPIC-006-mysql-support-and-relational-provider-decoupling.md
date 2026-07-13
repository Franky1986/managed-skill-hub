# EPIC-006: MySQL Support And Relational Provider Decoupling

## Status

Implemented (2026-07-09)

The implementation has been added across config, container wiring, provider
adapters, and rebuild path:

- Provider-separated catalog/search selection via `CATALOG_PROVIDER` and
  `SEARCH_PROVIDER`.
- MySQL catalog adapter and schema runner with relational tag tables.
- MySQL search adapter and schema runner with FULLTEXT and regex fallback.
- Normalized search score semantics across providers.
- Full rebuild use case and admin endpoint `POST /admin/projections/rebuild`.
- Verified by focused API/catalog/search/rebuild test coverage.

Current cutover status:

- SQLite/SQLite remains fully supported as the default.
- MySQL/SQLite is supported for catalog migration.
- MySQL/MySQL is supported for end-to-end catalog + search execution.

## Objective

Add first-class MySQL support for the metadata catalog and search stack while
preserving full feature parity with the current SQLite-backed behavior.

The result must remain hexagonal:

- application and domain layers stay storage-agnostic
- provider differences are isolated to outbound adapters
- migration/rebuild logic is explicit and testable
- no public/admin feature regresses when switching providers

This epic does not merely "make MySQL work". It introduces a provider model
that lets the system run with:

- SQLite catalog + SQLite search
- MySQL catalog + SQLite search
- MySQL catalog + MySQL search

and guarantees that all supported combinations preserve the current product
contract.

## Why This Epic Exists

The current architecture already exposes `SkillCatalogPort` and
`SkillSearchPort`, but the implementation still assumes SQLite-specific storage
and search behavior in several important places:

- SQLite schema creation and migration logic lives inside adapters
- SQLite JSON helpers are used for tag extraction/filtering
- SQLite FTS5 determines score semantics and ranking behavior
- search provider behavior is not yet normalized behind a strict parity
  contract

If MySQL is added naively, the codebase would drift into "same port, different
behavior". That would break the purpose of ports and adapters.

## Product Requirement: Full Feature Parity

This epic is successful only if MySQL-backed execution preserves all currently
shipped user-facing and agent-facing capabilities.

### Required Parity Areas

#### Public Read Path

- `GET /discover`
- `GET /skills`
- `GET /skills/search`
- `GET /categories`
- `GET /tags`
- `GET /skills/:id`
- `GET /skills/:id/manifest`
- `GET /skills/:id/files`
- `GET /skills/:id/versions`
- `GET /skills/:id/history`
- public skill/file judgement reads
- public extracted-content reads

#### Proposal Read / Status Path

- proposal status
- proposal lifecycle visibility
- proposal judgement visibility
- proposal file lists and extracted content
- duplicate-check behavior

#### Admin Read / Workflow Path

- admin proposal lists and filters
- admin draft/review lists and filters
- skill detail and proposal-context comparison behavior
- audit-backed lifecycle visibility
- proposal/skill/file judgement listing

#### Search Behavior

- category filter
- repeated tag filter with AND semantics
- keyword search
- fulltext search
- regex search
- typo-like fuzzy fallback
- one visible result row per skill on the public path
- latest published version metadata wins for visible public result cards

#### Projection / Rebuild Behavior

- indexing from published skill artifacts and extracted content
- projection of proposals, proposal files, skill files, judgements, and audit
  history
- deterministic rebuild from filesystem + audit primaries

## Non-Goals

- Replacing the filesystem as the primary artifact store
- Introducing PostgreSQL in this epic
- Introducing semantic/vector search
- Adding multi-tenant database partitioning
- Changing domain semantics for skills, proposals, or judgements
- Accepting partial feature parity for MySQL

## Architectural Decisions

### 1. Catalog Provider And Search Provider Must Be Independent

Configuration must be split into two explicit provider choices:

```env
CATALOG_PROVIDER=sqlite|mysql
SEARCH_PROVIDER=sqlite|mysql
```

Rationale:

- MySQL catalog support is easier and should land first
- search can remain SQLite-backed during transition
- provider migration can be staged safely
- search parity work remains isolated

### 2. Filesystem Remains The Primary Artifact Store

The filesystem stays authoritative for:

- skill artifacts
- proposal artifacts
- proposal manifests/YAML
- audit JSONL files

Relational providers remain projected read/write companions, not replacements
for binary/blob artifact storage in this epic.

### 3. Migration Must Rebuild From Primaries, Not Copy SQLite Internals

The supported migration path is:

- rehydrate from filesystem and audit primaries
- rebuild catalog projection into the target provider
- rebuild search documents into the target provider

The project must not rely on SQLite-to-MySQL direct SQL translation as the
primary migration strategy.

### 4. Search Score Semantics Must Be Provider-Neutral

Current SQLite FTS behavior and future MySQL `MATCH ... AGAINST` ranking use
different score semantics.

The application contract must define one neutral rule:

- if `score` is present, higher means more relevant

Every search adapter is responsible for normalizing its native ranking to that
contract before results leave the adapter.

### 5. MySQL Tag Filtering Should Be Relational, Not JSON-Dependent

For MySQL-backed catalog/search implementations, tags should be modeled via
relation tables rather than relying on JSON extraction for core filters.

Rationale:

- clearer indexes
- easier AND-filter semantics
- more predictable query planning
- less provider-specific JSON complexity

## Provider Matrix

### Phase-Target Matrix

| Catalog | Search | Status |
|---|---|---|
| SQLite | SQLite | must remain fully supported |
| MySQL | SQLite | required transition mode |
| MySQL | MySQL | required end state |

The project does not need to support SQLite catalog + MySQL search as a primary
target in this epic unless it falls out naturally from the provider wiring.

## Configuration Contract

Extend central config with:

```env
CATALOG_PROVIDER=sqlite
SEARCH_PROVIDER=sqlite

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=managed_skill_hub
MYSQL_USER=managed_skill_hub
MYSQL_PASSWORD=
MYSQL_SSL_MODE=preferred
MYSQL_CONNECT_TIMEOUT_MS=10000
MYSQL_QUERY_TIMEOUT_MS=30000
```

Rules:

- provider values are explicit and validated at startup
- MySQL config is required only when a selected provider uses MySQL
- startup must fail fast for incomplete selected-provider config
- no provider auto-detection from ambient environment

## Required Refactors Before MySQL Adapters

### 1. Extract Relational Schema/Migration Responsibility

Current SQLite adapters create and migrate schema internally. That must be
pulled behind provider-specific migration services or schema runners.

Required outcome:

- SQLite adapter no longer owns hidden one-off migration behavior
- MySQL adapter gets equivalent explicit schema setup
- schema evolution becomes auditable and testable per provider

### 2. Normalize Search Result Contract

Refactor search application flow so provider-specific ranking stays inside
search adapters.

Required outcome:

- adapters emit normalized `score`
- result ordering rules are consistent across providers
- deduplication logic does not assume SQLite score polarity

### 3. Introduce Full Projection Rebuild Use Case

Add a new use case that can fully rebuild relational projections from primary
state:

- skills and versions
- skill files
- proposals and proposal files
- proposal judgements
- skill/file judgements
- audit entries
- search documents

This must work against any configured providers.

## Implementation Plan

### 1. Provider-Neutral Configuration

Files:

- `apps/api/src/infrastructure/config.ts`
- `apps/api/src/infrastructure/config.spec.md`
- `.env.example`
- `.env.example`
- docs under `docs/setup/`

Changes:

- add `catalogProvider`
- add `searchProvider`
- add MySQL connection config
- fail fast on invalid provider combinations or missing MySQL config

### 2. Provider-Neutral Search Semantics

Files:

- `apps/api/src/application/ports/outbound/search.port.ts`
- `apps/api/src/application/ports/outbound/SkillSearchPort.spec.md`
- `apps/api/src/application/usecases/skill/skill-query.adapter.ts`
- search adapter tests

Changes:

- define normalized ranking semantics
- remove assumptions that a lower numeric score is better
- keep result deduplication and version selection behavior identical

### 3. Extract Relational Schema Management

New provider-local infrastructure modules, for example:

```text
apps/api/src/adapters/outbound/catalog/sqlite/sqlite.catalog-schema.ts
apps/api/src/adapters/outbound/catalog/mysql/mysql.catalog-schema.ts
apps/api/src/adapters/outbound/search/sqlite/sqlite.search-schema.ts
apps/api/src/adapters/outbound/search/mysql/mysql.search-schema.ts
```

Changes:

- move DDL and schema evolution out of runtime adapter query methods
- make schema initialization explicit
- keep adapter responsibilities focused on port behavior

### 4. Add `MysqlSkillCatalog`

New files:

```text
apps/api/src/adapters/outbound/catalog/mysql/mysql.skill-catalog.ts
apps/api/src/adapters/outbound/catalog/mysql/MysqlSkillCatalog.spec.md
apps/api/src/adapters/outbound/catalog/mysql/mysql.skill-catalog.test.ts
```

Responsibilities:

- implement `SkillCatalogPort`
- preserve all current list/filter/read semantics
- project skill/proposal/judgement/audit metadata
- support categories and tags listing
- support proposal filters and history reads

Recommended physical model:

- `skill_catalog_versions`
- `skill_catalog_files`
- `skill_catalog_judgements`
- `skill_catalog_proposals`
- `skill_catalog_proposal_files`
- `skill_catalog_audit_entries`
- `skill_catalog_version_tags`
- optionally equivalent relation tables for proposal tags if needed

### 5. Add `MysqlSkillSearch`

New files:

```text
apps/api/src/adapters/outbound/search/mysql/mysql.search.ts
apps/api/src/adapters/outbound/search/mysql/MysqlSkillSearch.spec.md
apps/api/src/adapters/outbound/search/mysql/mysql.search.test.ts
```

Responsibilities:

- implement `SkillSearchPort`
- use MySQL 8 `FULLTEXT` for fulltext/keyword search
- support repeated tag filters with AND semantics
- support category filters
- support regex search
- preserve typo-like fuzzy fallback behavior

Recommended physical model:

- `skill_search_documents`
- `skill_search_document_tags`

Notes:

- do not depend on JSON columns for tag filters
- normalize native `MATCH ... AGAINST` ranking to the shared search contract
- use bounded candidate sets and explicit timeout controls for regex behavior

### 6. Add Full Projection Rebuild Use Case

New files:

```text
apps/api/src/application/usecases/projection/rebuild-projections.usecase.ts
apps/api/src/application/usecases/projection/RebuildProjectionsUseCase.spec.md
apps/api/src/application/usecases/projection/rebuild-projections.usecase.test.ts
```

Responsibilities:

- rebuild catalog projection from filesystem/audit primaries
- rebuild search index/documents from published skill content and extracted text
- support provider cutover and disaster recovery

### 7. Wire Provider Selection In The Container

File:

- `apps/api/src/infrastructure/container.ts`

Changes:

- instantiate catalog provider from `CATALOG_PROVIDER`
- instantiate search provider from `SEARCH_PROVIDER`
- keep all use cases provider-agnostic

### 8. Add Operational Migration Path

Required operational flow:

1. configure MySQL provider(s)
2. run schema setup
3. run projection rebuild
4. run parity verification checks
5. switch runtime provider

This flow should be scriptable and documented.

## Search Parity Rules

These rules are non-negotiable because search is the highest-risk drift area.

### Keyword Search

- must remain useful for short intent phrases and titles
- stopword/provider differences may change raw scores, but not materially break
  relevant result retrieval

### Fulltext Search

- must search title, description, capabilities, and extracted body content
- must preserve category and tag narrowing

### Regex Search

- must remain bounded by timeout
- provider-specific regex syntax differences must not leak into the public API
  contract without explicit documentation

### Fuzzy Fallback

- typo-like queries such as `vido` must still find `video`-like content
- this fallback must not rely on SQLite-only features
- fallback behavior may be implemented in application code or adapter-local SQL,
  but must stay feature-parity visible

### Result Deduplication

- public search must still show at most one visible row per skill
- when several published versions match, visible metadata must resolve to the
  latest published version

## Acceptance Criteria

### Architecture

- no domain or use-case logic depends on SQLite- or MySQL-specific APIs
- provider selection happens only in infrastructure wiring
- schema management is explicit, not hidden inside runtime query code

### Catalog Parity

- MySQL catalog passes the same contract-level tests as SQLite catalog
- public/admin reads return equivalent data for the same primary state
- categories, tags, proposals, judgements, and history stay feature-complete

### Search Parity

- MySQL search passes provider-neutral contract tests
- repeated tag AND filtering behaves identically
- fuzzy fallback remains available
- public search dedup/version resolution remains unchanged

### Migration

- a documented rebuild path can populate MySQL from current filesystem/audit
  primaries
- migration does not require manual SQL export from SQLite as the primary path

### Operations

- startup fails fast on misconfiguration
- providers can be switched intentionally via environment configuration
- parity verification can be run before cutover

## Test Strategy

### Contract Tests

Run the same provider-neutral suites against:

- SQLite catalog
- MySQL catalog
- SQLite search
- MySQL search

### Golden-Parity Fixtures

Create deterministic fixtures covering:

- multiple published versions of one skill
- draft/rejected versions
- proposals in several lifecycle states
- tags and categories
- judgements with all dimensions
- audit history with publish/reject/change-note events
- mixed text and extracted binary-content search documents

Provider outputs must match on:

- returned IDs and metadata
- lifecycle visibility
- filter behavior
- visible result ordering rules where contractually defined

### Migration Tests

- rebuild from filesystem/audit into empty SQLite
- rebuild from filesystem/audit into empty MySQL
- compare outputs after rebuild

## Risks

- search relevance parity is harder than relational metadata parity
- regex behavior can drift subtly across providers
- hidden SQLite assumptions may remain in tests or helper logic
- inline adapter migrations can create divergent provider behavior if not
  extracted first

## Recommended Delivery Order

1. provider-neutral config and search contract cleanup
2. schema/migration extraction
3. full projection rebuild use case
4. MySQL catalog
5. catalog parity verification
6. MySQL search
7. search parity verification
8. operational cutover documentation

## Verification Commands

Minimum checks before calling this epic complete:

```bash
npm run typecheck --workspace=apps/api
npm run lint --workspace=apps/api
npm run test --workspace=apps/api
./scripts/check.sh
```

Provider-specific integration checks should also run against:

- SQLite catalog + SQLite search
- MySQL catalog + SQLite search
- MySQL catalog + MySQL search
