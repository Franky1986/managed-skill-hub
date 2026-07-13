# NPM Verification

## Align Workspace Versions

In a monorepo with workspaces, the version in the sub-app
(`apps/api/package.json`) must match the actually installed version.

Example: if root installs `@llamaindex/liteparse@2.4.0`, but
`apps/api/package.json` says `^0.1.0`, npm reports an
`ELSPROBLEMS (invalid)` error.

Solution: set the version in `apps/api/package.json` to `^2.4.0` and run
`npm install` again.

## Check Packages

### Is One Package Installed?

```bash
npm ls @llamaindex/liteparse
```

### Show Outdated Packages

```bash
npm outdated
```

### Show Vulnerabilities Without Automatic Fixes

```bash
npm audit --audit-level=moderate
```

## Warning: `npm audit fix` With Very New Packages

`npm audit fix` can fail for very new packages such as
`@llamaindex/liteparse` with errors like `ETARGET`, because the audit database
is not yet consistent.

**Solution:** install the package manually and skip `npm audit fix`:

```bash
npm install @llamaindex/liteparse
```

## Vulnerabilities In The Project

State after the July 2026 security hardening pass:

```text
npm audit --audit-level=moderate --package-lock-only
found 0 vulnerabilities
```

Resolved groups:

| Package/group | Resolution |
|---------------|------------|
| `@ai-sdk/provider-utils` / `ai` / `@ai-sdk/openai` / `jsondiffpatch` | Migrated the built-in judger to AI SDK 6 and OpenAI provider 3 using the stable structured `output` contract. |
| `fast-uri` / Fastify serializer/compiler chain | Migrated Fastify and all coupled plugins to Fastify 5-compatible versions. |
| `esbuild` / `vite` | Migrated the web workspace to Vite 6.4.3. |
| `tar` via `@mapbox/node-pre-gyp` | Replaced native `bcrypt` with `bcryptjs` and pruned the old install chain. |
| uuid < 11.1.1 | Updated to `^11.1.1`. |
| xlsx | Removed from the project. |

## Regular Checks

```bash
npm audit --audit-level=moderate
npm outdated
```

Run automatic fixes only when no very new packages are affected.

## Lessons Learned: npm-check-updates In The Monorepo

### What Happens With `npx npm-check-updates -u`?

`npm-check-updates` raises **all** dependencies to the newest major version
without checking compatibility.

### Risks

- **Breaking changes**: major versions can contain incompatible APIs.
- **Peer-dependency conflicts**: for example, `typescript@6.0.3` does not match
  `openapi-typescript@7.13.0`, which expects `typescript@^5.x`.
- **Workspace inconsistency**: root and sub-apps can land on different major
  versions.
- **Deprecated types**: `@types/uuid` is unnecessary from uuid@11 onward because
  uuid ships its own type definitions.

### Recommended Strategy For This Project

1. In root, update only independent devDependencies.
2. In sub-apps, check individually and do not blindly raise all major versions.
3. Keep critical packages conservative:
   - TypeScript 5.x until openapi-typescript supports TS 6
   - Fastify 5.x with matching `@fastify/*` plugin majors
   - Zod 3.x because it is widely used and stable
   - UUID 11.x, enough for this project; `@types/uuid` is not needed
4. After `npm-check-updates`, always run `npm install` and
   `npm run typecheck`.
5. Use `npm audit fix` only when no very new packages are affected.

### Current State After Stabilization

- TypeScript: ^5.7.3
- eslint: ^8.57.0 with @typescript-eslint ^7.18.0
- Fastify: ^5.10.0
- AI SDK: ^6.0.224 with @ai-sdk/openai ^3.0.84
- Vite: ^6.4.3
- Zod: ^3.24.2
- UUID: ^11.1.0 without @types/uuid
- Vitest: ^3.2.7

### Remaining Vulnerabilities

`npm audit --audit-level=moderate --package-lock-only` currently reports the
project as vulnerability-free.

Do not run `npm audit fix --force` blindly. It upgrades multiple major versions
at once and can change Fastify, Vite, and AI SDK APIs. Upgrade each workspace
deliberately and run the complete repository checks.
