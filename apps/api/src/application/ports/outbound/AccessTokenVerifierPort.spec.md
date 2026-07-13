# Access Token Verifier Port Specification

## Purpose

Validate Authentik-issued agent API access tokens and return only a
provider-neutral principal.

## Required Validation

- Token size and compact-JWS shape are bounded before cryptographic work.
- Exact configured issuer, client audience, authorized party when present,
  asymmetric algorithm allowlist, signature, expiry, not-before, stable subject,
  and requested area scope are validated.
- JWKS is loaded only from trusted provider metadata, cached with a bounded TTL,
  and refreshed once for an unknown key ID.
- Provider HTTP calls have strict timeout, origin, and response-size bounds.
- Proposal access requires the configured boolean human claim and is then
  evaluated by `AuthorizationPolicy`; service identities fail closed.
- Group and string claims have cardinality and length bounds.
- ID Tokens cannot authorize APIs because the required access-token scope claim
  and area scope must be present.
- Failure responses are generic; tokens and detailed claims never leave the
  adapter or enter routine logs.
