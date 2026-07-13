# Spec: SimpleAdminAuth (HTTP Adapter)

## Purpose

Protects admin endpoints in the MVP through simple login with username/password
from `.env`.

## Scope

- Login endpoint `POST /admin/login`
- Session endpoint `GET /admin/session`
- Session cookie with JWT
- Middleware for admin routes
- Logout `POST /admin/logout`
- Origin/Referer validation for authenticated admin mutations

## Non-Scope

- Roles and permissions
- authentik/OIDC; later
- Password reset
- Multi-user management

## Responsibilities

- Verify password with BCrypt.
- Issue JWT session.
- Validate session from cookie.
- Block admin routes without session by throwing `UnauthorizedError`.
- For authenticated `POST`, `PUT`, `PATCH`, and `DELETE` admin requests, reject
  browser requests whose `Origin`/`Referer` origin is neither the current request
  origin nor a configured allowed origin.
- Return auth errors through normalized JSON contract with `error`, `code`,
  `requestId`.
- Set session cookie on `/` path so it is reliably sent to `/admin` and
  `/api/admin` routes.
- `GET /admin/session` returns `{ username }` for valid session and HTTP 401
  for invalid/missing session.

## Inputs / Outputs

- Inputs: `{ username, password }`
- Outputs: Set-Cookie plus `{ success: true }` or 401 with normalized error
  payload
- Session read: cookie -> `{ username }` or 401

## Dependencies

- `ADMIN_USER`, optional `ADMIN_PASSWORD` or optional `ADMIN_PASSWORD_HASH`,
  `JWT_SECRET`, `SESSION_TTL_SECONDS`, `ADMIN_CSRF_ORIGIN_CHECK`,
  `CORS_ALLOWED_ORIGINS`, and `PUBLIC_API_BASE_URL` from `.env`

## Failure Modes

- Wrong credentials -> 401
- Missing cookie -> 401
- Invalid/expired JWT -> 401
- Authenticated admin mutation from an unexpected browser origin -> 401
- Cookie path mismatch -> browser does not send cookie to admin endpoints

## Acceptance Criteria

- Admin routes are unreachable without valid session.
- `GET /admin/session` returns `{ username }` for valid cookie.
- `GET /admin/session` returns HTTP 401 for missing/invalid cookie.
- Public read path remains unauthenticated.
- `ADMIN_PASSWORD` is accepted directly for local/dev-like setups.
- If `ADMIN_PASSWORD` is not set, `ADMIN_PASSWORD_HASH` is checked with BCrypt.
- Session cookie uses `path: '/'`.
- Mutating admin requests with unexpected browser origins are rejected after
  session validation.
- Web frontend checks session through `GET /admin/session` before rendering each
  admin page and redirects to `/admin/login` without valid session.

## Tests / Checks

- Integration tests for login/logout/session
- Middleware tests for protected routes: 401 without cookie, 200 with valid
  cookie
- Middleware tests for mutating route origin allow/deny behavior

## Agent Guardrails

- No auth logic in use cases.
- Never log passwords.
