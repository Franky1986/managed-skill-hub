# Spec: Web Router, Language Provider, And Admin Route Guard

## Purpose

Compose the frontend route tree, apply the global language provider, and ensure
admin pages render only for users with a valid admin session.

## Scope

- All routes served under the `/frontend` basename.
- Global `LanguageProvider` wrapping the route tree.
- Language resolution from URL, `localStorage`, browser language, and English
  fallback.
- All routes under `/admin` except `/admin/login`.
- Session validation through `GET /admin/session`.
- Redirect to `/admin/login` when no valid session exists.

## Non-Scope

- Backend authorization policy; see `SimpleAdminAuth.spec.md`.
- authentik/OIDC migration.
- Client-side role management.
- Server-side user language preferences.

## Responsibilities

- The app defaults to English.
- The URL parameter `?lang=en|de` wins over all other language sources.
- The selected language is persisted in `localStorage`.
- If no URL or stored preference exists, browser language may select German.
- Unsupported languages fall back to English.
- The provider sets `document.documentElement.lang`.
- `AdminRoute` checks the admin session asynchronously on mount.
- While the session is being checked, a localized loading state is shown.
- Missing, invalid, or expired sessions redirect to `/admin/login`.
- Valid sessions render nested admin pages through `<Outlet />`.
- `/admin/login` remains public so the login flow can work.

## Inputs / Outputs

- Inputs: browser path, query string, `localStorage`, browser language, httpOnly
  admin session cookie
- Outputs: rendered route, localized shell copy, or redirect to `/admin/login`

## Dependencies

- `LanguageProvider`
- `useAuthStore.checkSession()`
- `GET /admin/session`
- React Router v6

## Failure Modes

- Network error while checking the session -> treated as invalid session.
- Invalid cookie -> backend returns 401, frontend redirects to login.
- Missing cookie -> backend returns 401, frontend redirects to login.
- Unsupported language -> English fallback.

## Acceptance Criteria

- `/admin`, `/admin/drafts`, `/admin/review`, `/admin/skills/new`,
  `/admin/skills/:id`, `/admin/proposals`, and `/admin/proposals/:id` are
  inaccessible without a valid admin session.
- Directly opening an admin URL without a session redirects to `/admin/login`.
- Successful login redirects to `/admin`.
- `/admin/login` is reachable without a session.
- `?lang=de` selects the German UI.
- `?lang=en` selects the English UI.
- Stored language preference is reused.
- Browser German is honored when no URL or stored preference exists.
- Unknown languages fall back to English.

## Tests / Checks

- `npm run test --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `./scripts/check.sh`

## Agent Guardrails

- Do not put auth business logic outside the router/auth-store boundary.
- Do not store credentials client-side.
- Do not bypass the language provider with ad-hoc inline bilingual strings for
  new app-shell copy.
