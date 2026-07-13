# ADR-003: Simple Admin Auth In The MVP

## Status

Implemented compatibility mode; amended by ADR-015.

## Context

The admin path needs authentication. authentik already exists in the company,
but it should be integrated later so the MVP can start quickly.

## Decision

The MVP uses a simple login form and signed local session with a single admin
user.

- Username and password are configured through environment variables
  (`ADMIN_USER`, `ADMIN_PASSWORD`).
- The password is stored hashed in `.env` with BCrypt, not in clear text.
- The public read path remains unauthenticated.
- Authentik/OIDC is the multi-user alternative selected by `ADMIN_AUTH_MODE`.

## Consequences

- Very fast to implement.
- No dependency on authentik in the MVP.
- Only one admin account, no user management.
- Acceptable for internal company-network operation.
- Remains available for local operation and explicit rollback; it is never an
  implicit fallback while OIDC mode is selected.

## Open Points

- ADR-015 implements Authentik/OIDC, just-in-time users, and reviewer,
  publisher, and administrator roles while preserving this explicit mode.
- Simple-mode audit actors remain technical strings; OIDC actors use stable
  principal identity and client attribution.
