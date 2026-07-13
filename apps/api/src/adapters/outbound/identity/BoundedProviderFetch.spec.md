# Bounded Provider Fetch

## Purpose

Limit memory consumed by untrusted OIDC discovery, JWKS, token, and
introspection responses before their complete body is buffered.

## Contract

- Only URLs on the configured trusted provider origin are fetched.
- Redirects are never followed automatically.
- A declared `Content-Length` above the configured limit is rejected before
  reading the body.
- The response stream is consumed incrementally and cancelled as soon as the
  actual decoded body exceeds the limit.
- Callers receive a reconstructed response only after the bounded read
  completes.
- Raw provider bodies and credentials are never logged.
