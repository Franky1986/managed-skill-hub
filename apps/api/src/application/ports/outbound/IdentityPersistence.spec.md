# Identity Persistence Ports Specification

## Purpose

These ports isolate just-in-time principal projection, opaque administrator
sessions, and one-time OIDC login transactions from SQLite and MySQL details.

## Invariants

- External identities are unique by exact `(issuer, externalSubject)`.
- Mutable display names and email addresses update projections but never choose
  ownership or privileged roles.
- Cross-issuer linking occurs only when the application explicitly supplies an
  existing `linkToPrincipalId`; adapters never infer it from email or username.
- Raw administrator session IDs and OIDC state values are accepted by the port
  but only deterministic SHA-256 hashes are persisted.
- Session resolution rejects expired and revoked records.
- Login state consumption atomically distinguishes missing, expired, replayed,
  and successfully consumed transactions.
- Cleanup deletes at most the requested positive limit in deterministic expiry
  order.
- Authorization codes, access tokens, refresh tokens, and ID tokens are never
  accepted by or stored through these ports.
