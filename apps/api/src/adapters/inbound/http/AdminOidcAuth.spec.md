# Administrator OIDC Authentication Specification

## Routes

- `GET /admin/auth/methods` exposes the active mode, OIDC start URL, and configured
  administrator UI base path. It never exposes provider secrets.
- `GET /admin/auth/oidc/start` accepts an allowlisted relative path under
  `ADMIN_UI_BASE_PATH`, persists a short-lived transaction, and redirects to
  Authentik.
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
- Discovery issuer, authorization, token, and JWKS endpoints remain on the
  exact configured trusted provider origin; discovery redirects are disabled.
- Access, refresh, and ID tokens never leave the provider adapter.
- Local session IDs contain 256 random bits and are persisted only as SHA-256.
- The established cookie is `HttpOnly`, `Secure` in production,
  `SameSite=Strict`, and valid on root and configured API-prefix aliases.
- Session roles are bounded by absolute session expiry; disabled principals fail
  closed on every request.
- Admin, reviewer, and publisher routes enforce their roles server-side.
- Admin is a super-role; reviewer and publisher permissions remain distinct.
- Return paths must remain relative under the configured UI prefix; external,
  protocol-relative, backslash, and control-character forms are rejected.
- Login, callback denial/replay, session rejection/revocation, and authorization
  denial emit structured events without code, state, nonce, verifier, cookie,
  token, email, or subject values.
