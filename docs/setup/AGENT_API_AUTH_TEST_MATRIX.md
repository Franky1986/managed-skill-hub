# Agent API Auth Test Matrix

This document defines the expected behavior for every static bearer auth
permutation in EPIC-007.

## Variables Under Test

| Area | Env mode | Routes |
|---|---|---|
| Public read | `PUBLIC_READ_AUTH_MODE` | `/skills`, `/skills/search`, `/categories`, `/tags`, skill files/packages |
| Proposal | `PROPOSAL_AUTH_MODE` | duplicate check, submit, upload, finalize, notice, status |
| Discovery | `DISCOVERY_AUTH_MODE` | `/discover`, `/howToPropose`, `/openapi.yaml` |

Supported values are `none` and `bearer`.

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
totalPermutations=8
passedPermutations=8
failedPermutations=0
RESULT=PASS
```

## Expected Matrix

| Public read | Proposal | Discovery | Consumer read | Proposal actions | Discovery/how-to | Setup URL in `/discover` | How-to auth step | Generated setup fields |
|---|---|---|---|---|---|---|---|---|
| none | none | none | open | open | open | omitted | omitted | none; script stores alias/URL only if called directly |
| bearer | none | none | 401 without read token | open | open | present | present | read token only |
| none | bearer | none | open | 401 without proposal token | open | present | present | proposal token only |
| none | none | bearer | open | open | 401 without discovery token | present after authenticated discovery | present after authenticated how-to | no read/proposal token fields; script stores alias/URL only |
| bearer | bearer | none | 401 without read token | 401 without proposal token | open | present | present | read token and proposal token |
| bearer | none | bearer | 401 without read token | open | 401 without discovery token | present after authenticated discovery | present after authenticated how-to | read token only |
| none | bearer | bearer | open | 401 without proposal token | 401 without discovery token | present after authenticated discovery | present after authenticated how-to | proposal token only |
| bearer | bearer | bearer | 401 without read token | 401 without proposal token | 401 without discovery token | present after authenticated discovery | present after authenticated how-to | read token and proposal token |

## 401 Contract

A protected agent route returns a normalized `401` with machine-readable auth
details:

```json
{
  "code": "UNAUTHORIZED",
  "details": {
    "authRequired": true,
    "authArea": "public-read | proposal | discovery",
    "authScheme": "bearer",
    "discoverUrl": "https://example/api/discover",
    "credentialSetupScriptUrl": "https://example/api/agent-credentials/setup.sh",
    "recommendation": "Do not paste bearer tokens into agent chat..."
  }
}
```

Agent behavior:

1. Do not ask the user to paste bearer tokens into chat.
2. Explain which area is blocked from `details.authArea`.
3. Ask for permission to download/run `details.credentialSetupScriptUrl`.
4. Let the generated script open the local browser setup form, or use
   `--terminal` as fallback.
5. Read `~/.managed-skill-hub/credentials.json` by registry alias or normalized
   API base URL.
6. Retry the blocked call with the matching bearer token.

## UI Expectations

When no agent-facing auth is enabled:

- How-to UI does not show an auth/setup panel.
- `/howToPropose.requiredSteps[0]` is `Read this workflow first`.
- `/discover` omits `credentialSetupScriptUrl`.

When any agent-facing auth is enabled:

- How-to UI shows the auth/setup panel.
- The panel shows read/proposal auth status from `apiNotes`.
- The setup-script download is visible only when `credentialSetupScriptUrl` is
  present.
- `/howToPropose.requiredSteps[0]` is
  `Handle registry authentication outside chat`.

## Setup Script Expectations

The generated script is deployment-specific and contains no secrets.

- Default mode opens a local browser form on `127.0.0.1:<port>`.
- `--terminal` uses hidden terminal prompts.
- Only token fields required by the current config are rendered and persisted.
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
