# Agent API Auth Test Matrix

This document defines the expected behavior for all independent agent auth
permutations from EPIC-007 and EPIC-011.

## Variables Under Test

| Area | Env mode | Routes |
|---|---|---|
| Public read | `PUBLIC_READ_AUTH_MODE` | `/skills`, `/skills/search`, `/categories`, `/tags`, skill files/packages |
| Proposal | `PROPOSAL_AUTH_MODE` | duplicate check, submit, upload, finalize, notice, status |
| Discovery | `DISCOVERY_AUTH_MODE` | `/discover`, `/howToPropose`, `/openapi.yaml` |

Supported values are `none`, `bearer`, and `oidc`, producing 27 combinations.

## Automated Coverage

Run the full project check:

```bash
./scripts/check.sh
```

The matrix is covered by:

- `apps/api/src/adapters/inbound/http/agent-api-auth-matrix.test.ts`
- `apps/api/src/adapters/inbound/http/agent-api-auth.test.ts`
- `apps/api/src/adapters/inbound/http/skill-read.controller.test.ts`
- `apps/api/src/adapters/inbound/http/proposal.controller.test.ts`
- `apps/web/src/api/client.test.ts`

## Deterministic Proof Script

The full project check runs a deterministic matrix proof after the regular test
suite:

```bash
./scripts/check.sh
```

The proof can also be executed directly:

```bash
./node_modules/.bin/tsx scripts/check-agent-auth-matrix.ts
```

Successful runs write stable artifacts for agent review:

- `.tmp/agent-auth-matrix.log`: compact line-based pass/fail summary.
- `.tmp/agent-auth-matrix.json`: structured per-permutation report.

The expected success footer is:

```text
totalPermutations=27
passedPermutations=27
failedPermutations=0
RESULT=PASS
```

## Expected Matrix Rules

The automated matrix evaluates the Cartesian product. Each area follows only
its selected mode:

| Mode | Request behavior | Discovery metadata | Static setup field |
|---|---|---|---|
| `none` | open with anonymous principal | no scheme for that area | none |
| `bearer` | `401` until the exact static token is supplied | bearer scheme | read/proposal field only for that bearer area |
| `oidc` | `401` until the verifier accepts an access token for that area | one Device Authorization scheme with accumulated scopes/areas | none |

`credentialSetupScriptUrl` is present if and only if at least one area uses
`bearer`. OIDC-only deployments never prompt for or persist a static token.
Discovery OIDC remains valid but requires issuer/client bootstrap out of band;
normal Device Flow deployments keep discovery open.

The canonical OpenAPI security arrays enumerate only the credentialed bearer
and OIDC alternatives. They intentionally do not include `{}`, because that
would claim unconditional anonymous support. The root
`x-managed-skill-hub-runtime-auth` extension maps each area to its environment
selector; anonymous access exists only when that selector is `none`.

## 401 Contract

A protected agent route returns a normalized `401` with machine-readable auth
details:

```json
{
  "code": "UNAUTHORIZED",
  "details": {
    "authRequired": true,
    "authArea": "public-read | proposal | discovery",
    "authScheme": "bearer | oidc",
    "discoverUrl": "https://example/api/discover",
    "credentialSetupScriptUrl": "https://example/api/agent-credentials/setup.sh",
    "recommendation": "Do not paste bearer tokens into agent chat..."
  }
}
```

Bearer agent behavior:

1. Do not ask the user to paste bearer tokens into chat.
2. Explain which area is blocked from `details.authArea`.
3. Ask for permission to download/run `details.credentialSetupScriptUrl`.
4. Let the generated script open the local browser setup form, or use
   `--terminal` as fallback.
5. Read `~/.managed-skill-hub/credentials.json` by registry alias or normalized
   API base URL.
6. Retry the blocked call with the matching bearer token.

OIDC responses omit `credentialSetupScriptUrl` unless another area uses bearer
and direct the agent to `/discover` and the Device Authorization guide. The
agent starts a new trusted linkout and never asks for a token in chat.

## UI Expectations

When no agent-facing auth is enabled:

- How-to UI does not show an auth/setup panel.
- `/howToPropose.requiredSteps[0]` is `Read this workflow first`.
- `/discover` omits `credentialSetupScriptUrl`.

When static bearer auth is enabled:

- How-to UI shows the auth/setup panel.
- The panel shows read/proposal auth status from `apiNotes`.
- The setup-script download is visible only when `credentialSetupScriptUrl` is
  present.
- `/howToPropose.requiredSteps[0]` is
  `Handle registry authentication outside chat`.

When any OIDC area is enabled, the first how-to step is `Authorize the agent
through the human login link`, and the payload uses `Authorization: Bearer
<OIDC access token>` guidance rather than the static credential-file flow.

## Setup Script Expectations

The generated script is deployment-specific and contains no secrets.

- Default mode opens a local browser form on `127.0.0.1:<port>`.
- `--terminal` uses hidden terminal prompts.
- Only static bearer token fields required by the current config are rendered
  and persisted. OIDC areas never create setup fields.
- If public read is open, no read-token field or persistence code is generated.
- If proposal is open, no proposal-token field or persistence code is generated.
- Tokens are saved to `~/.managed-skill-hub/credentials.json` under the registry
  alias/base URL.

## Manual Smoke Commands

For a proposal-only protected setup:

```env
PUBLIC_READ_AUTH_MODE=none
PROPOSAL_AUTH_MODE=bearer
PROPOSAL_BEARER_TOKEN=proposal-token
DISCOVERY_AUTH_MODE=none
```

Expected checks:

```bash
curl -s http://localhost:3040/discover | jq '{readAuthRequired, proposalAuthRequired, credentialSetupScriptUrl}'
curl -i http://localhost:3040/categories
curl -i http://localhost:3040/proposals/notice
curl -i -H 'Authorization: Bearer proposal-token' http://localhost:3040/proposals/notice
curl -s http://localhost:3040/agent-credentials/setup.sh | rg 'Read bearer token|Proposal bearer token|entry.readToken|entry.proposalToken|MSH_REQUIRE_'
```

Expected result:

- discovery says `readAuthRequired=false`, `proposalAuthRequired=true`
- `/categories` is `200`
- proposal notice is `401` without token and `200` with token
- setup script contains proposal-token fields only

The short literal above is a development-only matrix fixture. Production
startup rejects static bearer values shorter than 32 bytes and known example
placeholders; generate production values with a cryptographic random source.
