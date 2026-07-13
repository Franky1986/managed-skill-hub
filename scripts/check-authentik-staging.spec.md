# Real Authentik Staging Gate

## Purpose

`check-authentik-staging.ts` is the explicit environment-dependent production
activation gate. It is not part of normal CI and must never be replaced by the
deterministic local provider proof.

## Inputs

- `RUN_AUTHENTIK_STAGING_CHECK=true`
- the complete OIDC staging environment, including both provider settings;
- `AUTHENTIK_STAGING_ACCESS_TOKEN`, a short-lived access token obtained through
  the real agent Device Authorization flow;
- `AUTHENTIK_STAGING_ID_TOKEN`, the corresponding ID token from the same
  Token Endpoint response;
- `AUTHENTIK_STAGING_EVIDENCE_FILE`, an operator-created JSON file following
  `docs/setup/authentik-staging-evidence.example.json`.

The tokens are read only from the process environment and are never printed or
written. The evidence must contain deployment labels and booleans only, never
user identifiers, proposal UUIDs, provider secrets, or tokens.

## Behavior

The gate fails unless admin and proposal OIDC modes are active, live provider
discovery succeeds, Device Authorization metadata is present, the production
verifier accepts the real access token as a human submitter, and every schema-v2
manual staging check has fresh evidence no older than 30 days.

Before proving token-class separation, the gate independently validates the ID
token signature, issuer, client audience, expiry, issued-at time, type, subject,
and authorized party. Its subject must equal the accepted access-token subject.
When the ID token contains `at_hash`, the gate also validates the cryptographic
access-token binding. OIDC permits Token Endpoint ID tokens to omit `at_hash`;
in that case `tokensFromSameTokenResponse=true` is operator evidence of common
provenance, not a cryptographic claim. The already validated ID token must then
be rejected by the API access-token verifier.

The sanitized result, including whether binding was `at_hash` or
`same_subject`, is written to `.tmp/authentik-staging-gate.json`.
