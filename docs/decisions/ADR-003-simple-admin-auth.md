# ADR-003: Simple Admin Auth In The MVP

## Status

Accepted

## Context

The admin path needs authentication. authentik already exists in the company,
but it should be integrated later so the MVP can start quickly.

## Decision

The MVP uses simple HTTP basic auth with a single admin user.

- Username and password are configured through environment variables
  (`ADMIN_USER`, `ADMIN_PASSWORD`).
- The password is stored hashed in `.env` with BCrypt, not in clear text.
- The public read path remains unauthenticated.
- authentik/OIDC follows in a later step.

## Consequences

- Very fast to implement.
- No dependency on authentik in the MVP.
- Only one admin account, no user management.
- Acceptable for internal company-network operation.
- Must later be replaced by authentik.

## Open Points

- A later ADR will document the move to authentik/OIDC.
- Multi-user support, roles, and audit metadata such as `created_by` and
  `approved_by` are technical strings in the MVP, not verified identities.
