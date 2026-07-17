# Spec: Vite Development Proxy

## Purpose

Provide the browser-facing `/api` boundary during local development without
requiring nginx and without coupling the frontend to the API port.

## Contract

- `VITE_USE_API_PROXY=true` makes browser clients use the same-origin `/api`
  base path.
- `VITE_API_BASE_URL` is the backend proxy target in development.
- `API_PREFIX` is the path at which the backend exposes normal API routes.
- The proxy maps browser `/api/*` requests to `API_PREFIX/*` on the backend.
- Empty, `/api`, and custom backend prefixes are supported.
- With `VITE_USE_API_PROXY=false`, the browser uses `VITE_API_BASE_URL`
  directly and Vite does not register the API proxy.

## Guardrails

- Proxy configuration must not require nginx for local development.
- Query strings and request bodies must be preserved.
- The root discovery convenience response must use the same proxy boundary.

## Verification

- `src/api/vite-proxy.test.ts` proves empty, `/api`, and custom prefix mapping.
- `src/api/client.test.ts` proves browser base-URL selection.
- The local restart helper verifies `/api/discover` through the frontend port.
