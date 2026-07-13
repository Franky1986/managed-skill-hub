# Identity Provider Port Specification

## Purpose

Isolate OIDC discovery, authorization URL construction, PKCE, callback
validation, and code exchange from HTTP controllers and application use cases.

## Rules

- Implementations use a maintained OIDC standards library.
- Issuer and callback URI are exact trusted configuration, never token- or
  request-selected values.
- Authorization Code requests use random state, nonce, and PKCE S256.
- Code exchange validates expected state, nonce, PKCE verifier, and an ID Token.
- Provider tokens and authorization codes never cross this port after a
  successful exchange; the result is a provider-neutral verified identity.
- Discovery and token HTTP calls have bounded time and response sizes and fail
  closed.
