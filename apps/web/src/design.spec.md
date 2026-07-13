# Spec: Web Frontend Design

## Purpose

Visual and interaction design system for the `managed-skill-hub` React
frontend. This spec complements the product-level
[`docs/product/DESIGN_AGENT_BRIEF.md`](../../docs/product/DESIGN_AGENT_BRIEF.md)
and is the concrete implementation guide for developers.

## Scope

- Design system: colors, typography, spacing, shadows, icons.
- Reusable UI components.
- Page layouts for public and admin areas.
- Interaction patterns and state displays.
- English-first UI copy with German available through language toggle.

## Non-Scope

- Business logic; this stays in the backend.
- New API endpoints.
- Logo/brand development outside the frontend.
- Backend-driven i18n.

## Tech Requirement

**Styling uses Tailwind CSS v4 with the Vite plugin.**

- No styled-components / Emotion.
- No inline `style={{ ... }}` in JSX.
- No handwritten `*.module.css` files for component styling; Tailwind replaces
  that approach.
- Custom design tokens such as colors, fonts, spacing, and radius are registered
  in `apps/web/src/index.css` through `@theme`.
- Every component uses Tailwind utility classes directly in JSX.

## Stack

- React 18 + TypeScript
- Vite with `@tailwindcss/vite`
- Tailwind CSS v4 with `@import "tailwindcss"` in `index.css`
- Icons: Material Symbols (Google Fonts)
- Fonts: Inter, JetBrains Mono (Google Fonts)

## Localization

- English is the default and canonical UI copy language.
- German is available through the app-shell language toggle.
- Language resolution is defined in `apps/web/src/router.spec.md`.
- New visible copy must use the central i18n catalog and `useLanguage()`.
- Do not add hardcoded English-only or German-only text for new UI copy.
- API responses remain English; frontend presentation may localize known stable
  error `code` values.
- The UI language is not the agent conversation language. Agent-facing API
  guidance must tell agents to answer users in the language the user is
  currently using.

## File Structure

```text
apps/web/src/
  index.css          # Tailwind import + @theme design tokens
  i18n/              # language provider and message catalogs
  components/
    ui/              # optional reusable Tailwind components
      Button.tsx
      Badge.tsx
      ...
    domain/          # domain-specific components
      SkillCard.tsx
      SkillFileTree.tsx
      ...
  pages/
    HomePage.tsx
    SearchPage.tsx
    SkillDetailPage.tsx
    HowToProposePage.tsx
    admin/
      AdminDashboardPage.tsx
      ...
```

## Design System: Tailwind `@theme`

Defined in `apps/web/src/index.css`:

```css
@import "tailwindcss";

@theme {
  --color-background: #f9f9ff;
  --color-surface: #f9f9ff;
  --color-surface-container-lowest: #ffffff;
  --color-surface-container-low: #f0f3ff;
  --color-surface-container: #e7eefe;
  --color-surface-container-high: #e2e8f8;
  --color-surface-container-highest: #dce2f3;
  --color-surface-variant: #dce2f3;
  --color-on-background: #151c27;
  --color-on-surface: #151c27;
  --color-on-surface-variant: #434655;
  --color-primary: #004ac6;
  --color-primary-container: #2563eb;
  --color-on-primary: #ffffff;
  --color-on-primary-container: #eeefff;
  --color-primary-fixed: #dbe1ff;
  --color-primary-fixed-dim: #b4c5ff;
  --color-secondary: #0058be;
  --color-secondary-container: #2170e4;
  --color-on-secondary: #ffffff;
  --color-on-secondary-container: #fefcff;
  --color-tertiary: #006242;
  --color-tertiary-container: #007d55;
  --color-on-tertiary: #ffffff;
  --color-on-tertiary-container: #bdffdb;
  --color-error: #ba1a1a;
  --color-error-container: #ffdad6;
  --color-on-error: #ffffff;
  --color-on-error-container: #93000a;
  --color-outline: #737686;
  --color-outline-variant: #c3c6d7;
  --color-inverse-surface: #2a313d;
  --color-inverse-on-surface: #ebf1ff;
  --color-inverse-primary: #b4c5ff;

  --font-h1: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-h2: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-h3: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-body: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-small: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --text-h1: 1.875rem;
  --text-h1--line-height: 2.25rem;
  --text-h1--font-weight: 600;
  --text-h2: 1.5rem;
  --text-h2--line-height: 2rem;
  --text-h2--font-weight: 600;
  --text-h3: 1.25rem;
  --text-h3--line-height: 1.75rem;
  --text-h3--font-weight: 500;
  --text-body: 1rem;
  --text-body--line-height: 1.5rem;
  --text-body--font-weight: 400;
  --text-small: 0.875rem;
  --text-small--line-height: 1.25rem;
  --text-small--font-weight: 400;
  --text-mono: 0.875rem;
  --text-mono--line-height: 1.25rem;
  --text-mono--font-weight: 400;

  --radius-sm: 0.25rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;

  --spacing-gutter: 1.5rem;
  --spacing-xl: 2.5rem;
  --spacing-margin-desktop: 2rem;
  --spacing-margin-mobile: 1rem;
}
```

Additional utility classes:

```css
.material-symbols-outlined {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
.material-symbols-outlined.fill {
  font-variation-settings: 'FILL' 1;
}
.shadow-ambient {
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
}
.hover-lift {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.hover-lift:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
}
```

## Components: Draft

### Base

- `Button`: Tailwind utility button:
  `bg-primary-container text-on-primary-container rounded-lg ...`.
- `IconButton`: icon-only button with Material Symbol.
- `Badge`: status/risk badge with matching colors.
- `Card`: `bg-surface-container-lowest border border-outline-variant rounded-xl shadow-ambient`.
- `Skeleton`: animated gray blocks.
- `EmptyState`: icon plus title plus description plus CTA.
- `Alert`: inline banner for info/success/warning/error.

### Domain

- `SkillCard`: title, category, status badge, tags, description.
- `SkillFileTree`: folder/file tree with Material Symbols.
- `SearchInput`: single search bar without mode selection.
- `CategoryCard`: icon plus title plus description.

## Page Layouts

### Public Layout

- Sticky top nav bar with brand, links, actions.
- Footer with links.
- Main content in `max-w-7xl mx-auto`.

### Admin Layout

- Optional sidebar or continued top nav plus content.
- Clear visual separation between public and admin through primary color.

## Interaction Patterns

1. Loading: skeletons or centered text.
2. Error: inline alert banner.
3. Search: one unified query input with paginated results; backend search mode
   is an implementation detail.
4. Hover lift on cards.
5. Focus ring through Tailwind `focus-within:`.

## Accessibility

- Sufficient contrast.
- Focus indicators through Tailwind.
- `aria-label` for icon buttons.
- Semantic HTML.

## Constraints

- Styling only through Tailwind.
- No changes to API client or auth logic.
- Admin routes remain protected through `AdminRoute` in `router.tsx`.

## Frontend API Client Conventions

- All mutating POST/PATCH/PUT calls to the backend send an explicit JSON body
  (`{}` instead of `null`/`undefined`) and set
  `Content-Type: application/json`.
- This avoids `415 Unsupported Media Type` when Fastify would interpret empty
  bodies as `application/x-www-form-urlencoded`.

## Admin Workbench Data Loading

- Admin detail pages, for example skill workbench, load dependent context data
  such as files and judgements directly after initial load of the main
  aggregate, independent of the React `useEffect` cycle.
- The same load function is reused in `useEffect` for manual version changes to
  avoid duplication and reduce race conditions.

## Acceptance Criteria

- [ ] Tailwind v4 is installed and Vite plugin is configured.
- [ ] `index.css` contains `@import "tailwindcss"` and `@theme` tokens.
- [ ] Home page is implemented according to delivered design.
- [ ] Layout with top nav bar and footer matches the new design.
- [ ] UI copy is catalog-backed in English and German.
- [ ] `./scripts/check.sh` and `npm run build:prod` pass.

## References

- [`docs/product/DESIGN_AGENT_BRIEF.md`](../../docs/product/DESIGN_AGENT_BRIEF.md)
- [`apps/web/src/router.tsx`](./router.tsx)
- [`apps/web/src/index.css`](./index.css)
- [`apps/web/src/components/Layout.tsx`](./components/Layout.tsx)
- [`apps/web/src/pages/HomePage.tsx`](./pages/HomePage.tsx)
