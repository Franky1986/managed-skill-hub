# Administrator OIDC Authentication Specification

## Routes

- `GET /admin/auth/methods` exposes only the active mode and OIDC start URL.
- `GET /admin/auth/oidc/start` accepts an allowlisted relative `/admin` return
  path, persists a short-lived transaction, and redirects to Authentik.
- `GET /admin/auth/oidc/callback` consumes state once, performs server-side
  Authorization Code + PKCE exchange, projects the principal, creates an opaque
  local session, and redirects to the stored relative path.
- `GET /admin/session` exposes display identity, local roles, mode, and expiry;
  it never exposes provider tokens, claims, subject, email, or internal ID.
- `POST /admin/logout` revokes and clears the local session.
- `POST /admin/login` is not registered in OIDC mode.

## Security

- State, nonce, and PKCE verifier are cryptographically random and state is
  stored only as SHA-256.
- Callback state is one-time, short-lived, and consumed before code exchange.
- Callback and redirect URI are exact configuration, not request headers.
- Provider code exchange and ID Token validation use `openid-client`.
- Access, refresh, and ID tokens never leave the provider adapter.
- Local session IDs contain 256 random bits and are persisted only as SHA-256.
- The established cookie is `HttpOnly`, `Secure` in production,
  `SameSite=Strict`, and valid on root and configured API-prefix aliases.
- Session roles are bounded by absolute session expiry; disabled principals fail
  closed on every request.
- Admin, reviewer, and publisher routes enforce their roles server-side.
- Return paths must remain relative under `/admin`; external, protocol-relative,
  backslash, and control-character forms are rejected.
