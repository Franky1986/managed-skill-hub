# Deterministic OIDC Provider Proof

## Purpose

`check-oidc-provider.ts` runs the production access-token verifier against a
local, deterministic OpenID Provider metadata and JWKS HTTP server. Normal CI
therefore exercises real `openid-client` discovery and `jose` remote-JWKS
behavior without depending on Authentik or an external network.

## Contract

The proof must verify:

- explicitly allowed loopback HTTP discovery for local development and CI;
- resolved Device Authorization metadata;
- an Authentik-shaped signed access token with `uid` and exact `azp`;
- explicit `jwt_profile` access-token validation mode;
- independent validation of a realistic `typ=JWT` OIDC ID token with exact
  issuer, client audience, subject, expiry, and a valid `at_hash` binding;
- rejection of that valid ID token as an API access token;
- unknown-key JWKS refresh and signing-key rotation;
- stable principal ownership across signing-key rotation;
- fail-closed behavior when a new key appears during a JWKS outage.

The provider binds only to `127.0.0.1` on an operating-system-assigned port.
No token, private key, user claim set, or provider secret is written to proof
artifacts. Results are written to `.tmp/oidc-provider.json` and
`.tmp/oidc-provider.log`.
