# Layered Environment Loader Specification

## Purpose

Load non-secret runtime configuration and local secret material consistently
for repository shell entrypoints.

## Inputs And Precedence

1. Values explicitly exported by the calling process have highest precedence.
2. `/.env.secrets` supplies local secret values.
3. `/.env` supplies non-secret configuration and has lowest precedence.

Missing files are allowed. Neither file is printed, copied into logs, nor
written by the loader.

## Contract

- `/.env` must not contain keys ending in `_PASSWORD`, `_PASSWORD_HASH`,
  `_SECRET`, `_TOKEN`, or `_API_KEY`.
- `/.env.secrets` is ignored by Git and should have mode `0600`.
- Tracked `.env.example*` profiles contain non-secret settings only.
- `.env.secrets.example` is the canonical blank secret-key inventory.
- Shell entrypoints source this helper rather than implementing independent
  load order.
- Production build entrypoints export `NODE_ENV=production` before loading
  files, so a development profile cannot produce a development React bundle.
- The API's Node loader applies the same precedence by loading secrets before
  config; `process.loadEnvFile` preserves already exported variables.

## Security

Agents may inspect and edit `.env` and tracked profile templates. They should
not read or edit `.env.secrets`; a human or deployment secret manager owns that
file. No command may display secret values during migration or validation.
