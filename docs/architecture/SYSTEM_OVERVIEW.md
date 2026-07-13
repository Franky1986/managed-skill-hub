# SYSTEM_OVERVIEW - managed-skill-hub

## In One Sentence

A self-hosted, agent-facing skill registry with configurable filesystem or database-backed managed content storage, configurable relational metadata/search providers, an OpenAPI-first REST API, and a simple session-based admin path as a precursor to later OAuth/OIDC integration.

## Context

- Users: product managers, developers, AI agents such as Codex, Claude,
  OpenCode, Gemini, and Cursor.
- Public read, proposal, and discovery paths can be open or protected with
  configured bearer authentication.
- Admin path currently uses a session cookie and simple admin auth; later it
  should use authentik/OIDC.
- Managed skill/proposal content is stored through `CONTENT_STORAGE_PROVIDER`.
  - `filesystem` stores artifacts, aggregate state, extracts, and audit entries under `DATA_DIR`.
  - `database` stores managed content in database-backed adapters following `CATALOG_PROVIDER` (`sqlite` or `mysql`).
  - Categories, skill/version/file metadata, proposal metadata, judgements, and history are projected into configurable relational providers (`sqlite` or `mysql`) and read from there.

## Accepted Authentik Target

[ADR-015](../decisions/ADR-015-authentik-oidc-and-delegated-agent-identity.md)
defines the accepted but not yet implemented identity target:

- admin login uses server-side OIDC Authorization Code with PKCE and a local
  `HttpOnly` session;
- agents use Authentik Device Authorization so a human can authorize work from
  a clickable conversation link;
- discovery, published reads, proposals, and admin login remain independently
  configurable;
- existing active human Authentik users can submit proposals by default without
  local account import;
- proposal ownership uses a stable human principal, not email, username, or a
  shared bearer label;
- privileged roles use stable subject UUIDs and `managedskillhub-*` groups.

Current runtime behavior remains simple admin auth plus `none`/`bearer` agent
API auth until the ADR implementation gate is complete.

## Components

```text
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│    Agents    │      │   Admin UI   │      │     CLI      │
│  (Codex...)  │      │   (React)    │      │   (later)    │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                     │
       │ REST                │ REST                │ REST/MCP
       │ configurable auth   │ session/auth        │
       │                     │                     │
       └─────────────────────┴─────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   Fastify API   │
                    │  (TypeScript)   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐   ┌────────▼────────┐   ┌──────▼──────┐
│  Application  │   │     Domain      │   │   OpenAPI   │
│   Use Cases   │◄──┤   Skill, etc.   │   │   Contract  │
└───────┬───────┘   └─────────────────┘   └─────────────┘
        │
        │ Ports
        │
┌───────▼───────────────────────────────────────────────┐
│ Adapters: Storage (FS/DB), Search (sqlite/mysql), Audit (FS/DB) │
│           Identity (simple auth today, authentik later)      │
└─────────────────────────────────────────────────────────┘
        │
        │
┌───────▼───────────────────────────────────────────────┐
│ Infrastructure: DATA_DIR, sqlite content/catalog/search DBs, optional mysql │
└─────────────────────────────────────────────────────────┘
```

## Data Flow: Reads

1. Agent calls `GET /discover`.
2. Agent searches with `GET /skills/search?q=...`.
3. Agent loads `GET /skills/:id/manifest`.
4. API reads skill/version/file metadata from the selected catalog/search provider.
5. Agent loads `GET /skills/:id/files/:fileId` when needed.

## Data Flow: Writes

1. Admin creates or updates a skill through the admin API.
2. Domain validates status transitions.
3. Storage adapter writes aggregate state and files through the configured content storage provider.
4. Selected catalog and search projections are updated.
5. Audit adapter writes an entry through the configured audit storage provider.

## Important Working Rule For Skill Changes

- Skill changes must never be treated as storage-only changes.
- Whenever a skill is created, deleted, replaced, renamed, or structurally
  changed, the catalog projection must be considered as well.
- For many UI and API reads, the configured projection provider is the metadata
  read model; changing only the physical content store is therefore insufficient.
- For inconsistencies, always inspect:
  - `skill_catalog_versions`
  - `skill_catalog_files`
  - `skill_catalog_judgements`
  - `skill_catalog_audit_entries`
- Inspect `skill_catalog_*` / `skill_search_*` tables (or sqlite-backed
  equivalents) for cross-provider parity.
- Typical failure mode: artifacts were removed from the physical content store, but projections still expose stale skill metadata publicly.

## Status Model

```text
draft -> in_review -> approved -> published -> deprecated
draft|in_review|approved -> rejected
```

Only `published` skills are delivered through the public read path.

## Storage Locations

| Data | Path |
|------|------|
| Managed content, filesystem mode | `DATA_DIR/skills`, `DATA_DIR/proposals`, `DATA_DIR/audit` |
| Managed content, SQLite database mode | `DATA_DIR/index/search.db` content tables |
| Managed content, MySQL database mode | MySQL content tables in `MYSQL_DATABASE` |
| Uploads / temporary files | `DATA_DIR/uploads` |
| Search index / catalog projection | `DATA_DIR/index` (sqlite mode) |
| Search index / catalog projection | MySQL tables in `MYSQL_DATABASE` (mysql mode) |
| Observability snapshot | `DATA_DIR/observability` |
| Backups | `DATA_DIR/backups` |

## Non-Trivial Boundaries With Specs

- `apps/api/src/domain/skill/Skill.spec.md`
- `apps/api/src/domain/skill/SkillVersion.spec.md`
- `apps/api/src/ports/SkillRepositoryPort.spec.md`
- `apps/api/src/ports/SkillSearchPort.spec.md`
- `apps/api/src/ports/SkillFileStoragePort.spec.md`
- `apps/api/src/ports/AuditLogPort.spec.md`
- `apps/api/src/adapters/inbound/http/SkillReadController.spec.md`
- `apps/api/src/adapters/inbound/http/AdminSkillController.spec.md`
