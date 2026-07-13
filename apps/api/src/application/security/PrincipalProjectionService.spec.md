# Principal Projection Service Specification

## Purpose

Create and refresh stable internal principals only after an inbound OIDC adapter
has verified an external identity.

## Rules

- Exact issuer and stable subject are the primary external identity key.
- Profile fields are refreshed but never used as identity keys.
- Agent and administrator provider subjects may be linked only when both exact
  issuers are configured, share the same trusted Authentik origin, and expose
  the same stable subject value. Operators must configure both Authentik
  providers with `sub_mode=user_uuid`.
- No unconfigured issuer participates in cross-provider correlation.
- Group count is bounded before projection.
- Disabled principals fail closed.
- The service delegates all group and subject role mapping to
  `AuthorizationPolicy` and returns a provider-neutral OIDC principal.
