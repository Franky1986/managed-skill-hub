# Authentik Access Token Verifier Specification

## Purpose

Validate Authentik-issued agent API access tokens behind the provider-neutral
`AccessTokenVerifierPort` and return an authenticated principal.

## Validation

- Trust only the statically configured issuer and endpoints on its exact origin.
- Require an asymmetric `RS256`, `PS256`, or `ES256` signature from remote JWKS.
- Require exact issuer, audience, `azp`, non-empty subject, non-empty Authentik
  access-token `uid`, expiry, not-before, `openid`, and the area scope.
- In `jwt_profile` mode, require RFC 9068 `typ=at+jwt` (or
  `application/at+jwt`) and reject `JWT`, missing, ID-token, and other types.
- In `authentik_introspection` mode, permit Authentik's `typ=JWT` only after a
  confidential, same-provider introspection call confirms `active=true`, exact
  original client ID, and exact subject. Local signature and claim validation
  remains mandatory before introspection.
- Require the configured boolean human claim for proposal access and apply the
  provider-neutral area/group policy after projection.
- Bound raw token bytes, scope count/text, group count, group values, profile
  text, provider response size, timeout, clock tolerance, and JWKS cache age.
- Reject ID-token-shaped JWTs, service identities for proposals, duplicate or
  malformed groups, symmetric algorithms, and all malformed claims.

## Staging ID-Token Evidence

The concrete verifier also exposes a staging-only evidence operation. Callers
must first validate the access token through `verifyAccessToken` and then pass
the resulting external subject together with the access and ID tokens.

- Verify the ID-token signature against the same JWKS and require the exact
  issuer, client audience, expiry, issued-at time, subject, and allowed
  asymmetric algorithm.
- Accept only an absent `typ` or `typ=JWT`; an access-token type is invalid as
  ID-token evidence.
- Require the ID-token subject to equal the already accepted access-token
  subject. Apply the OIDC multi-audience and `azp` rules.
- If `at_hash` is present, validate it in constant time against the supplied
  access token using the ID-token signing algorithm. A mismatched or malformed
  hash fails closed.
- If `at_hash` is absent, report only `same_subject`. OIDC permits omission for
  tokens returned by the Token Endpoint, so same-response provenance remains
  separate operator evidence and is not described as cryptographic binding.

## Provider Behavior

- Discovery uses `openid-client`; JWT and JWKS validation use `jose`.
- HTTPS is mandatory except for explicitly validated localhost/loopback issuer
  URLs used in development and deterministic CI.
- Redirects are disabled for discovery, JWKS, and introspection fetches.
- Provider bodies are read incrementally and cancelled immediately when their
  decoded size exceeds the fixed response limit.
- An unknown `kid` triggers one explicit JWKS reload. Rotation succeeds only
  when the new key validates; provider or parse failure fails closed.
- Successful discovery is cached for the verifier lifetime and successful JWKS
  keys use the configured bounded cache. Stale keys are not accepted after a
  failed unknown-key refresh.

## Observability

Provider initialization, access-token validation, ID-token evidence validation,
and unknown-key refresh emit only event name, outcome, API area, and coarse
category. Tokens, headers, claims, subjects, profile data, and key material are
never emitted.
