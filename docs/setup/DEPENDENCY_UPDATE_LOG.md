# Dependency Update Log

## Current Status - 2026-07-13

The security follow-up completed the previously deferred migrations:

- Fastify 5.10 with matching plugin majors
- AI SDK 6 with OpenAI provider 3 and the stable structured `output` contract
- Vite 6.4.3
- `bcryptjs` instead of native `bcrypt`
- one consistent Vitest 3.2.7 installation across API and web workspaces

`npm audit --audit-level=moderate --package-lock-only` reports zero
vulnerabilities. The remainder of this document records the earlier July 1
upgrade experiment and stabilization decisions for historical context.

## Date

2026-07-01

## Starting Point

Project `managed-skill-hub` had just been initialized. The original versions
were chosen conservatively:

- TypeScript ^5.5.3
- eslint ^8.57.0
- @typescript-eslint/* ^7.15.0
- Fastify ^4.28.1
- Zod ^3.23.8
- Vitest ^2.0.2

## Steps Performed

### Step 1: npm-check-updates In Root

```bash
cd /path/to/managed-skill-hub
npx npm-check-updates -u
```

Result: root `package.json` was raised to newest major versions:

| Package | Old | New |
|---------|-----|-----|
| @types/node | ^20.14.10 | ^26.1.0 |
| @typescript-eslint/eslint-plugin | ^7.18.0 | ^8.62.1 |
| @typescript-eslint/parser | ^7.18.0 | ^8.62.1 |
| eslint | ^8.57.0 | ^10.6.0 |
| prettier | ^3.3.2 | ^3.9.4 |
| typescript | ^5.5.3 | ^6.0.3 |

### Step 2: npm install In Root

```bash
npm install
```

Result: new versions installed. Warning about peer dependency conflict:

```text
npm warn peer typescript@"^5.x" from openapi-typescript@7.13.0
```

`openapi-typescript` does not support TypeScript 6.x yet.

### Step 3: npm-check-updates In `apps/api`

```bash
cd apps/api
npx npm-check-updates -u
```

Result: `apps/api/package.json` was raised to newest major versions:

| Package | Old | New |
|---------|-----|-----|
| fastify | ^4.28.1 | ^5.9.0 |
| @fastify/cookie | ^9.3.1 | ^11.0.2 |
| @fastify/cors | ^9.0.1 | ^11.2.0 |
| @fastify/multipart | ^8.3.0 | ^10.0.0 |
| @fastify/swagger | ^8.14.0 | ^9.7.0 |
| @fastify/swagger-ui | ^4.0.1 | ^6.0.0 |
| bcrypt | ^5.1.1 | ^6.0.0 |
| better-sqlite3 | ^11.1.2 | ^12.11.1 |
| js-yaml | ^4.1.0 | ^5.2.0 |
| jsonwebtoken | ^9.0.2 | ^9.0.3 |
| uuid | ^11.1.1 | ^14.0.1 |
| zod | ^3.23.8 | ^4.4.3 |
| vitest | ^2.0.2 | ^4.1.9 |
| axios | ^1.7.2 | ^1.18.1 |
| tsx | ^4.16.2 | ^4.22.4 |

### Step 4: npm install In Root Monorepo

```bash
cd /path/to/managed-skill-hub
npm install
```

Result: all workspaces were installed with the new versions.

Warning:

```text
npm warn deprecated @types/uuid@11.0.0: This is a stub types definition.
uuid provides its own type definitions, so you do not need this installed.
```

### Step 5: npm audit

```bash
npm audit
```

Result before stabilization:

```text
5 vulnerabilities (3 moderate, 1 high, 1 critical)
```

All remaining vulnerabilities affect the dev-tool chain:

- `esbuild` (moderate)
- `vite` / `vite-node` / `@vitest/mocker` through `esbuild`

### Step 6: npm audit fix

```bash
npm audit fix
```

Result: no automatic fixes possible because remediation requires breaking
changes such as vite@8.1.2.

## Problems And Consequences

1. **TypeScript 6.x** has a peer-dependency conflict with
   `openapi-typescript@7.13.0`.
2. **Fastify 5.x** and **Zod 4.x** introduce breaking API changes.
3. **Vitest 4.x** is very new and can be incompatible with older plugins.
4. **@types/uuid** is unnecessary from uuid@11 onward.
5. Root `package.json` temporarily had `@llamaindex/liteparse` as a dependency,
   although it belongs in `apps/api`.

## Stabilization Decision

To guarantee a functioning MVP, these versions were reset to stable major
versions:

| Package | After update | Stabilized to |
|---------|--------------|---------------|
| typescript | ^6.0.3 | ^5.7.3 |
| eslint | ^10.6.0 | ^8.57.0 |
| @typescript-eslint/* | ^8.62.1 | ^7.18.0 |
| fastify | ^5.9.0 | ^4.28.1 |
| @fastify/* | v10/v11 | v8/v9 |
| zod | ^4.4.3 | ^3.24.2 |
| uuid | ^14.0.1 | ^11.1.0 |
| vitest | ^4.1.9 | ^3.0.5 |
| bcrypt | ^6.0.0 | ^5.1.1 |
| better-sqlite3 | ^12.11.1 | ^11.1.2 |
| js-yaml | ^5.2.0 | ^4.1.0 |
| jsonwebtoken | ^9.0.3 | ^9.0.2 |
| axios | ^1.18.1 | ^1.7.2 |
| tsx | ^4.22.4 | ^4.16.2 |
| @types/bcrypt | ^6.0.0 | ^5.0.2 |

## Remaining Vulnerabilities At That Time

After stabilization:

```text
5 vulnerabilities (3 moderate, 1 high, 1 critical)
```

All were in the dev-tool chain `esbuild` / `vite` / `vitest`. This was accepted
temporarily for the internal MVP and was resolved by the July 13 follow-up.

## Learnings

- `npm-check-updates -u` blindly raises all major versions.
- In monorepos, root and workspace versions must remain consistent.
- `npm audit fix` does not work when fixes require breaking changes.
- Very new packages such as `@llamaindex/liteparse` can produce `ETARGET`
  errors in the npm audit database.
- `@types/uuid` is no longer needed from uuid@11 onward.

## Historical Next Steps (Superseded 2026-07-13)

The July 13 dependency baseline completed these steps. Current clean installs
must preserve the committed lockfile:

1. Run locally:
   ```bash
   npm ci --legacy-peer-deps
   ```
2. Test `npm run typecheck`.
3. Test `npm run lint`.
4. Require `npm audit --audit-level=moderate --package-lock-only` to remain at
   zero before release.

## AP-15: Stabilize Build Chain (2026-07-01)

### Goal

`npm run typecheck`, `npm run lint`, and `npm run test` must run without
errors.

### Steps Performed

1. **TypeScript deprecation**
   - Problem: `baseUrl` in `tsconfig.json` is reported as deprecated in
     TypeScript 6.x.
   - Solution: added `"ignoreDeprecations": "6.0"` to the root TSConfig.

2. **ESLint flat config**
   - Problem: ESLint 10.x no longer recognizes `.eslintrc.json`.
   - Solution: removed `.eslintrc.json` and created `eslint.config.mjs` with
     `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`.
   - Set `@typescript-eslint/no-explicit-any` to `off` because adapters for
     dynamic imports intentionally use `any`.

3. **Vitest configuration**
   - `apps/api/vitest.config.ts` with environment `node`.
   - `apps/web/vitest.config.ts` with environment `node` and
     `passWithNoTests`.
   - Added `test: vitest run --passWithNoTests` to
     `packages/openapi/package.json` and `packages/shared/package.json`.

4. **Web Vite config**
   - Added `apps/web/vite.config.ts` with `@vitejs/plugin-react` and port from
     `FRONTEND_PORT`.

5. **Fixed backend typecheck errors**
   - Added `StorageError` and `IntegrityError`.
   - Corrected relative import paths in scanners and judger.
   - Aligned `search.port.ts`, `skill-query.port.ts`, and `skill.mapper.ts`
     types/paths.
   - Introduced `SkillQueryAdapter` as glue between repository, search,
     storage, and audit.

6. **First unit tests**
   - Domain tests for `SkillId`, `Skill`, `SkillVersion`, and `Manifest`.

### Result

```bash
npm run typecheck   # OK
npm run lint        # OK
npm run test        # OK (33 API tests)
./scripts/check.sh  # OK
```

### Note About Version Drift

This July 1 note described version drift that was resolved on July 13. The
current clean baseline is lockfile-driven:

```bash
npm ci --legacy-peer-deps
npm run typecheck
npm run lint
npm run test
```

## AP Follow-Up: Production Build (2026-07-01)

### Goal

`npm run build:prod` must create a startable `apps/api/dist/server.js`.

### Problem

- `tsc -p tsconfig.json` created ESM output, but Node.js could not resolve
  relative imports without `.js` extensions.
- `import yaml from 'js-yaml'` failed because `js-yaml` is a CommonJS module
  without a default export.
- tsconfig `paths` aliases such as `@domain/*` are not resolved to filesystem
  paths by `tsc`; they were not used in code anyway.

### Solution

1. `apps/api/tsconfig.json` and `packages/shared/tsconfig.json` were
   temporarily changed to `module: NodeNext` and `moduleResolution: NodeNext`.
2. All relative imports in `apps/api/src` and `packages/shared/src` were
   extended with `.js`, for example `from './Skill'` -> `from './Skill.js'`.
3. `import yaml from 'js-yaml'` was corrected to
   `import * as yaml from 'js-yaml'`.
4. tsconfig `paths` were removed from workspace TSConfigs because they were
   unused.

### Result

```bash
npm run build:prod   # OK
cd apps/api
node dist/server.js  # starts outside restrictive sandboxes
```

### Note

Startup was tested in the sandbox until the `listen` step. Binding to
`127.0.0.1:3002` is not allowed in the sandbox because of network restrictions.
Local startup works without restrictions.
