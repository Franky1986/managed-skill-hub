# Frontend Design Brief - managed-skill-hub

## Goal

Create a fresh, modern, and user-friendly UI design for the
`managed-skill-hub` web application. The design must cover both the public
skill viewer/discovery area and the protected admin workbench area.

This document is an **instruction for a design agent**. Based on this brief,
the agent should produce a concrete design concept: visual direction, component
library, page structure, and interaction patterns. The result should be an
implementable specification in `apps/web/src/design.spec.md` plus a storyboard
or mockup collection.

## Context

- **Project**: self-hosted skill registry for AI agents.
- **Users**: product managers, developers (admins), and AI agents as public API
  consumers.
- **Web frontend**: React + TypeScript + Vite.
- **Styling**: currently straightforward utility classes. Tailwind is allowed
  when it materially improves the design.
- **Architecture**: OpenAPI-first, admin path through session cookie, public
  path without auth.
- **Language policy**: UI defaults to English and can be switched to German.
  Agent-facing instructions and specs are canonical in English.

## Design Principles

1. **Clarity before decoration**
   - Every page has a clear primary task.
   - Low visual noise, generous whitespace, clear hierarchy.
   - Colors and icons have consistent meaning.

2. **Modern, friendly aesthetic**
   - Rounded corners, subtle shadows, gentle transitions.
   - One primary color with subtle accents, for example blue/indigo; no loud
     gradient overload.
   - Dark admin dashboard is optional, not required.

3. **Usability**
   - Important actions are reachable without scrolling.
   - Forms have inline validation and clear error messages.
   - Empty, loading, and error states are designed; no blank white spaces.

4. **Trust and seriousness**
   - Admin area must feel safe and controlled.
   - Status badges (`published`, `draft`, `in_review`, `deprecated`) are
     color-coded and unambiguous.
   - Sensitive actions such as publish, deprecate, delete, and reject have
     clear confirmation moments.

5. **Agent-friendly public pages**
   - Skills are easy to find through search, filters, and categories.
   - Skill detail page clearly shows metadata, file tree, entrypoint, and
     guardrails (`useWhen` / `doNotUseWhen`).
   - Downloads and extracts are easy to access.
   - Proposal submission is agent-facing: the UI explains the workflow, while
     the user's local agent uses `/discover` and `/howToPropose`.

## Color Palette: Proposal

| Role | Color | Usage |
|------|-------|-------|
| Primary | `#2563EB` (Blue 600) | Links, primary buttons, active navigation |
| Primary hover | `#1D4ED8` (Blue 700) | Hover state |
| Success | `#10B981` (Emerald 500) | `published`, success messages |
| Warning | `#F59E0B` (Amber 500) | `in_review`, hints |
| Danger | `#EF4444` (Red 500) | `deprecated`, delete, reject, errors |
| Info | `#3B82F6` (Blue 500) | `draft`, neutral hints |
| Neutral | `#6B7280` (Gray 500) | Secondary text, placeholders |
| Background | `#F9FAFB` (Gray 50) | Page background |
| Surface | `#FFFFFF` | Cards, dialogs |
| Text | `#111827` (Gray 900) | Primary text |

## Typography

- **Font family**: system stack or Inter if external loading is allowed. Prefer
  system stack to avoid new external dependencies.
- **Hierarchy**:
  - H1: 1.875rem / font-semibold
  - H2: 1.5rem / font-semibold
  - H3: 1.25rem / font-medium
  - Body: 1rem / normal
  - Small/caption: 0.875rem
  - Mono: paths, IDs, UUIDs, digests with `font-mono`

## Required Component Library

The agent should define a reusable set of UI components. For every component:
name, purpose, variants, states, placement.

### Base

- `Button`: primary, secondary, danger, ghost, loading, disabled.
- `IconButton`: compact actions in lists/trees.
- `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`.
- `Label`, `HelperText`, `ErrorMessage`.
- `Badge`: skill status, category, proposal status.
- `Card`: skill card, metric card, info panel.
- `Skeleton`: loading state for cards, lists, trees.
- `EmptyState`: illustration/icon plus text and optional CTA.
- `Toast` / `Alert`: success/error/warning messages.
- `Modal` / `Dialog`: confirmations and detail views.
- `Tooltip`: shortened IDs, icon buttons, status hints.

### Domain-Specific

- `SkillCard`: title, category, tags, status badge, short description,
  UUID/digest preview.
- `SkillFileTree`: folder/file tree with expand/collapse, MIME-type icons,
  admin-only actions.
- `SkillStatusBadge`: color-coded for `draft`, `in_review`, `approved`,
  `published`, `deprecated`.
- `ProposalStatusBadge`: color-coded for `submitted`, `judged`, `rejected`,
  `converted`.
- `CategoryPill`: clickable filter chip.
- `SearchInput`: search mode selector for keyword/fulltext/regex.
- `ManifestPanel`: structured skill metadata display.
- `JudgementPanel`: risk dimensions, overall judgement, rationale.
- `AuditTimeline`: chronological skill/proposal history.
- `ObservabilityDashboard`: counters, area summaries, timeline, histogram,
  export CTAs.
- `AdminHeader`: navigation, login status, logout.
- `PublicHeader`: logo, search, HowToPropose CTA.

## Page Structure

### Public Area

1. **Home (`/`)**
   - Hero with short explanation and search bar.
   - Category grid as fast entry.
   - List of newest/featured published skills.
   - Prominent link to the HowToPropose page for agent-facing proposals.

2. **Search (`/search`)**
   - Search bar at top, search mode toggle, category filter.
   - Result list as SkillCards.
   - Pagination or infinite scroll.
   - Empty state with suggestion to adjust the query.

3. **Skill Detail (`/skills/:id`)**
   - Header: title, status badge, category, tags.
   - Tabs or sections: overview, manifest, files, history.
   - Overview: description, `entrypoint`, `useWhen`, `doNotUseWhen`,
     `capabilities`.
   - File tree: folder structure, text viewer, download links, collapsed
     extracted content.
   - Metadata panel: `skillUuid`, `versionUuid`, `contentDigest`,
     `artifactId`, `sha256`.
   - Version selector when available.

4. **How To Propose (`/how-to-propose`)**
   - Explains that proposals are submitted by the user's local agent.
   - Shows that agents must read `/discover` and `/howToPropose`.
   - Presents package preflight, duplicate check, and upload responsibilities.

### Admin Area: Protected

1. **Login (`/admin/login`)**
   - Centered login card, minimal design.
   - Error display below the form.
   - Redirect to `/admin` after login.

2. **Dashboard (`/admin`)**
   - Overview: number of skills, proposals, newest activity.
   - Observability snapshot: top counters, latest requests, latest errors.
   - Quick actions: new skill, search reindex, refresh metrics.

3. **Skill List (`/admin/skills`)**
   - Table or card list of all skills, published and unpublished.
   - Filters by status/category.
   - Per-skill actions: view, edit, review workflow.

4. **Skill Detail / Workbench (`/admin/skills/:id`)**
   - Header with status, version selector, workflow buttons:
     `submitForReview`, `approve`, `publish`, `deprecate`.
   - File tree with folder context, upload target, move/rename/delete, text
     editor.
   - Tabs: details, files, manifest, judgements, history.
   - Visible hint when actions create a new draft patch version.

5. **Skill Create (`/admin/skills/new`)**
   - Form: ID, title, description, category, tags, capabilities, entrypoint.
   - Inline validation, for example skill ID rules.

6. **Proposals List (`/admin/proposals`)**
   - List with status, skill relationship, date.
   - Filter by status.

7. **Proposal Detail (`/admin/proposals/:id`)**
   - Proposal metadata, file tree, judgements.
   - Reject form with reason.
   - Conversion preview: target skill, mode, next version, entrypoint.
   - Actions: reject, convert, delete.

## Interaction Patterns

### Navigation

- **Public**: header with logo, search, categories, HowToPropose.
- **Admin**: sidebar or topbar with dashboard, skills, proposals, logout.
- **Breadcrumbs** on detail pages when useful; optional.

### Feedback

- Buttons show loading spinner during API calls.
- Success messages appear as toast or inline banner.
- Errors are displayed through `handleApiError`; admin errors may show
  `originalError`.
- Confirmation dialog for destructive actions: delete, reject, deprecate,
  convert.

### File Tree: Skill/Proposal

- Folders can expand/collapse.
- Files have icons by MIME type.
- Admin: folder can be selected as upload target.
- Admin: file actions appear on hover or in a dropdown.
- Text files open in an inline viewer; binary files as download.
- Extracted content is collapsed initially and can be opened.
- Invisible-character toggle in text viewer.

### Forms

- Fields are clearly labeled.
- Required fields are marked.
- Tags/capabilities as chip input or comma-separated with preview.
- Category select uses `/categories` as suggestions but allows free text.

### Responsive Behavior

- Mobile-first is not mandatory, but layouts must not break on smaller screens.
- Admin sidebar collapses to a hamburger menu.
- Tables become card lists on narrow viewports.

## Accessibility Baseline

- Semantic HTML: `main`, `nav`, `header`, `section`.
- Sufficient contrast: WCAG AA.
- Focus indicators for keyboard users.
- Form fields with correct `label` and `htmlFor`.
- ARIA labels for icon buttons.
- Status communication not only through color: icon plus text.

## Design Agent Deliverables

1. **Visual concept**
   - Final color palette, optionally CSS custom properties.
   - Typography rules.
   - Example mockups for Home, Skill Detail, Admin Dashboard, Admin Skill
     Workbench as text description or linked assets.

2. **Component catalog**
   - Complete list of proposed components with props/variants.
   - Placement in pages.

3. **Implementation plan**
   - Order for implementing pages/components.
   - Recommended CSS strategy: Tailwind vs. CSS modules vs. styled-components.
   - References to existing files that must change:
     `apps/web/src/router.tsx`, `apps/web/src/api/admin.ts`, and similar.

4. **Updated specification**
   - `apps/web/src/design.spec.md` with the final design contract.
   - Progress docs updated: `CURRENT_STATUS.md`, `NEXT_STEPS.md`,
     `CHANGELOG_INTERNAL.md`.

## Constraints And Guardrails

- No business logic in UI; UI only calls use cases/APIs.
- No direct filesystem access from the frontend.
- No new heavy UI frameworks without discussion; prefer lightweight choices.
- Admin routes must use the `AdminRoute` protection from
  `apps/web/src/router.tsx`.
- If a new favicon/logo is designed, store it as SVG in the repo under
  `apps/web/public/`.
- `data/` is not affected by design work.

## Acceptance Criteria For The Design Result

- [ ] Design is consistent for public and admin areas.
- [ ] All existing pages are covered by the design.
- [ ] Component catalog is complete and close to implementation.
- [ ] Color and typography system is documented.
- [ ] Accessibility baseline is considered.
- [ ] `apps/web/src/design.spec.md` is created or updated.
- [ ] `./scripts/check.sh` passes after design implementation.

## References

- [`apps/web/src/router.tsx`](../../apps/web/src/router.tsx) - current routes
- [`apps/web/src/api/admin.ts`](../../apps/web/src/api/admin.ts) - admin API client
- [`apps/web/src/api/skills.ts`](../../apps/web/src/api/skills.ts) - public skill API client
- [`apps/web/src/store/auth.ts`](../../apps/web/src/store/auth.ts) - auth store
- [`packages/openapi/skill-registry.openapi.yaml`](../../packages/openapi/skill-registry.openapi.yaml) - API contract
- [`docs/roadmap/EPIC-002-agent-workbench-ui.md`](../roadmap/EPIC-002-agent-workbench-ui.md) - epic goals
- [`docs/architecture/SYSTEM_OVERVIEW.md`](../architecture/SYSTEM_OVERVIEW.md) - architecture

---

*Status: 2026-07-03*
