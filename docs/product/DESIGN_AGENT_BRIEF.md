# Design Agent Brief - managed-skill-hub

## Your Task

Create a fresh, modern, and user-friendly UI design for the
`managed-skill-hub` web frontend. You do **not** deliver a runnable React
application. You deliver a **design system and concrete visual specifications**
that a developer can implement 1:1 in React and Tailwind CSS.

## Project In One Sentence

`managed-skill-hub` is a self-hosted skill registry for AI agents: product
managers and developers manage, approve, and version skills; agents discover
and load them.

## Audiences

| Group | Usage |
|-------|-------|
| AI agents / consumers | Read published skills through the API, sometimes through the web UI |
| Product managers (admin) | Create, version, review, and approve skills |
| Developers (admin) | Upload/edit files, convert proposals, inspect observability |

## Tech Stack: Do Not Change

- **Framework**: React 18 + TypeScript
- **Build**: Vite
- **Routing**: React Router v6
- **State**: Zustand
- **HTTP**: Axios
- **Styling**: **Tailwind CSS v4** with `@tailwindcss/vite`; design tokens via
  `@theme` in `apps/web/src/index.css`; utility classes directly in JSX. No
  `*.module.css`, no styled-components, no inline CSS.

## Design Requirements

### 1. Style Direction

- Fresh, modern, clean.
- Generous whitespace, clear hierarchy.
- Rounded corners, subtle shadows, gentle hover transitions.
- No gradient overload and no playful illustrations.
- Primary color: blue/indigo family.
- Admin area should feel controlled and serious; public area should feel open
  and inviting.

### 2. Colors: Proposal, Finalizable

| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#2563EB` | Primary buttons, links, active nav |
| Primary hover | `#1D4ED8` | Hover |
| Success | `#10B981` | `published`, success |
| Warning | `#F59E0B` | `in_review`, hints |
| Danger | `#EF4444` | `deprecated`, delete, reject, errors |
| Info | `#3B82F6` | `draft`, neutral hints |
| Neutral | `#6B7280` | Secondary text |
| Background | `#F9FAFB` | Page background |
| Surface | `#FFFFFF` | Cards, dialogs |
| Text | `#111827` | Primary text |
| Border | `#E5E7EB` | Borders, dividers |

### 3. Typography

- System font stack, no external font loading.
- H1: 1.875rem / semibold
- H2: 1.5rem / semibold
- H3: 1.25rem / medium
- Body: 1rem
- Small: 0.875rem
- Mono: for UUIDs, digests, paths

### 4. Pages To Design

#### Public: No Auth

1. **Home `/`**
   - Hero with short explanation and search bar.
   - Category grid.
   - List of newest/featured skills.
   - Link to the HowToPropose page; proposals are submitted by the user's local
     agent, not through a public submit form.

2. **Search `/search`**
   - Search bar plus mode toggle: keyword/fulltext/regex.
   - Category filter.
   - Skill card list with pagination or equivalent result management.
   - Empty state.

3. **Skill Detail `/skills/:id`**
   - Title, category, status badge, tags.
   - Tabs/sections: overview, manifest, files, history.
   - File tree with text viewer, download, extracted content.
   - Metadata panel: UUIDs, digests.

4. **How To Propose `/how-to-propose`**
   - Human-readable explanation of the agent-facing proposal workflow.
   - Clear distinction: users do not submit proposals through the UI; their
     local agent reads `/discover` and `/howToPropose`.
   - Show required preflight, duplicate check, package normalization rules, and
     the expectation that proposal metadata should preferably be English.

#### Admin: Protected

1. **Login `/admin/login`**
   - Centered card, minimal design.

2. **Dashboard `/admin`**
   - Overview metrics: skills, proposals.
   - Observability snapshot: counters, requests, errors.
   - Quick actions: new skill, reindex, metrics.

3. **Skill List `/admin/skills`**
   - Table/card list of all skills.
   - Filters: status/category.
   - Actions: view, edit.

4. **Skill Workbench `/admin/skills/:id`**
   - Header with version selector and workflow buttons.
   - File tree with upload target, move/rename/delete, text editor.
   - Tabs: details, files, manifest, judgements, history.

5. **Skill Create `/admin/skills/new`**
   - Form with inline validation.

6. **Proposals List `/admin/proposals`**
   - List with status, skill relationship, date.

7. **Proposal Detail `/admin/proposals/:id`**
   - Metadata, file tree, judgements.
   - Reject form and conversion preview.

### 5. Components To Define

For every component: name, purpose, variants, states, placement.

**Base**

- Button, IconButton
- Input, Textarea, Select, Checkbox, Switch
- Label, HelperText, ErrorMessage
- Badge
- Card
- Skeleton
- EmptyState
- Toast/Alert
- Modal/Dialog
- Tooltip

**Domain**

- SkillCard
- SkillFileTree
- SkillStatusBadge
- ProposalStatusBadge
- CategoryPill
- SearchInput
- ManifestPanel
- JudgementPanel
- AuditTimeline
- ObservabilityDashboard
- AdminHeader / PublicHeader

## Deliverables

1. **Design system spec**
   - Final color palette with hex values.
   - Typography scales.
   - Spacing, radius, shadows.
   - As a text table or CSS variable list.

2. **Component catalog**
   - Every component with visual description.
   - Variants and states.
   - Used CSS custom properties or color hex values.

3. **Page mockups**
   - At least 6 pages as textual description or image:
     - Home
     - Search
     - Skill Detail (public)
     - Admin Dashboard
     - Admin Skill Workbench
     - Admin Proposal Detail
   - For every page: layout, components, main actions, empty/error states.

4. **Tailwind structure**
   - Design tokens: colors, typography, spacing, radius, shadows are registered
     in `apps/web/src/index.css` through `@theme`.
   - Every page/component uses Tailwind utility classes directly in JSX.
   - Optional reusable components under `apps/web/src/components/ui/`.
   - No `*.module.css`, no inline CSS.

5. **Updated specifications**
   - Update `apps/web/src/design.spec.md` with the final design.
   - Update `docs/progress/CURRENT_STATUS.md`, `NEXT_STEPS.md`,
     `CHANGELOG_INTERNAL.md`.

## Constraints

- **Styling exclusively through Tailwind CSS v4.**
- No changes to business logic.
- No new API endpoints.
- No new heavy UI libraries.
- Admin routes must remain protected through `AdminRoute`.
- No direct filesystem access from the frontend.

## Start

1. Read this file.
2. Read `apps/web/src/design.spec.md`.
3. Inspect current pages under `apps/web/src/pages/` and
   `apps/web/src/pages/admin/`.
4. Inspect `apps/web/src/router.tsx` for route structure.
5. Create the design system, mockups, and component catalog.
6. Update `apps/web/src/design.spec.md` with your result.
7. Document progress in `docs/progress/`.

## References

- [`apps/web/src/design.spec.md`](../../apps/web/src/design.spec.md)
- [`apps/web/src/router.tsx`](../../apps/web/src/router.tsx)
- [`apps/web/src/pages/`](../../apps/web/src/pages/)
- [`packages/openapi/skill-registry.openapi.yaml`](../../packages/openapi/skill-registry.openapi.yaml)
- [`docs/roadmap/EPIC-002-agent-workbench-ui.md`](../roadmap/EPIC-002-agent-workbench-ui.md)

---

*Requirement: styling through Tailwind CSS v4. Status: 2026-07-03*
