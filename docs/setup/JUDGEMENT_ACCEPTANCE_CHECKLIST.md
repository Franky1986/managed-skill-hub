# Judgement And Publication Acceptance Checklist

## Purpose

Use this checklist to verify judgement visibility, retry behavior, and
publication policy with real runtime profiles. The operator changes only
non-secret settings in `.env`, restarts the services, uploads one disposable
simple skill, records the observed UI behavior, and posts the sanitized result.

Never include `.env.secrets`, provider tokens, uploaded confidential content,
cookies, or raw provider responses in evidence.

## Run Header

```text
Run ID:
Commit SHA:
Date/time (UTC):
Operator:
Profile:
JUDGER_PROVIDER:
PUBLISH_JUDGEMENT_POLICY:
Result directory:
Notes:
```

## Common Procedure

1. Change the documented non-secret settings in `.env`.
2. Restart both services and capture the sanitized service output:

   ```bash
   RUN_ID='judge-YYYY-MM-DD-NN'
   RUN_DIR=".tmp/judgement-acceptance/$RUN_ID"
   mkdir -p "$RUN_DIR"
   bash scripts/restart-all.sh restart | tee "$RUN_DIR/start.log"
   cp .tmp/restart-all.log "$RUN_DIR/server.log"
   ```

3. Upload one disposable skill with a small `SKILL.md`, finalize the upload,
   and open its admin proposal view.
4. Record only state labels, HTTP status/error code, provider name, and whether
   each expected control was visible. Do not copy raw judgement prompts or
   provider responses.
5. Scan evidence before another agent reads it:

   ```bash
   if rg -l '(Authorization:|Cookie:|Set-Cookie:|password=|api[_-]?key|access_token|id_token|refresh_token)' "$RUN_DIR" >/dev/null; then
     echo 'sensitiveEvidenceScan=FAIL'
   else
     echo 'sensitiveEvidenceScan=PASS'
   fi
   ```

## Scenario Summary

| ID | Profile | Status | Result reference |
|---|---|---|---|
| JUDGE-00 | Automated baseline | `[x] PASS` | `judge-2026-07-14-implementation` |
| JUDGE-01 | Contradictory built-in provider configuration | `[ ] NOT RUN` | |
| JUDGE-02 | Explicit no-provider profile | `[ ] NOT RUN` | |
| JUDGE-03 | Real provider success | `[x] PASS` | `judge-2026-07-14-custom-provider-01` |
| JUDGE-04 | Provider failure and retry | `[ ] NOT RUN` | |
| JUDGE-05 | Converted proposal lifecycle | `[ ] NOT RUN` | |
| JUDGE-06 | Publication policy matrix | `[ ] NOT RUN` | |

Use exactly one final status per scenario: `PASS`, `FAIL`, `BLOCKED`, or
`NOT RUN`.

## JUDGE-00: Automated Baseline

- [x] `./scripts/check.sh` succeeds.
- [x] `npm run build:prod` succeeds.
- [x] `npm audit --audit-level=moderate` reports zero vulnerabilities.
- [x] API tests include judgement state ordering, converted proposal retry,
      stored file retry, publication gate, and administrator override coverage.

Status: `[x] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

Result: `judge-2026-07-14-implementation`; 404 API tests in 61 files and 31
web tests passed. The production build completed with only the known Vite chunk
size warning, and npm reported zero vulnerabilities.

## JUDGE-01: Contradictory Built-In Provider Configuration

Use a local non-production process:

```dotenv
JUDGER_PROVIDER=vercel-ai-sdk
JUDGER_ADAPTER_PATH=./path/to/private-custom.judger.ts
PUBLISH_JUDGEMENT_POLICY=warn
```

Do not configure a provider API key for this negative test.

- [ ] Startup succeeds locally and logs `judger_adapter_path_ignored`.
- [ ] Startup identifies `vercel-ai-sdk` as the active provider; it never claims
      the custom-provider custom adapter is active.
- [ ] Finalization succeeds even though judgement cannot complete.
- [ ] The finalize response does not report `completed`.
- [ ] The admin proposal view shows `failed` for the proposal and affected
      files, with provider `vercel-ai-sdk` and no raw provider error.
- [ ] Production configuration with the same contradictory provider/path pair
      fails before listening.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## JUDGE-02: Explicit No-Provider Profile

```dotenv
JUDGER_PROVIDER=noop
JUDGER_ADAPTER_PATH=
PUBLISH_JUDGEMENT_POLICY=warn
```

- [ ] Finalization reports `unavailable`, not `completed`.
- [ ] The proposal status is `unavailable` and identifies provider `noop`.
- [ ] Every uploaded file has a visible `unavailable` state, even when no real
      result exists.
- [ ] The UI explains that no real security assessment was produced.
- [ ] Retry remains available to reviewers and preserves terminal lifecycle
      status where applicable.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## JUDGE-03: Real Provider Success

Configure either a valid `vercel-ai-sdk` provider or the custom-provider custom
adapter. Store its secret only in `.env.secrets`.

- [x] Startup logs the intended provider without an ignored-adapter warning.
- [x] Finalization reports `completed` only when proposal and all files have a
      real result.
- [x] Proposal and file states show `completed`, provider, and attempt time.
- [x] Overall and per-file result summaries remain visible after navigation and
      service restart.
- [x] Runtime logs contain structured `judgement_execution` success events but
      no uploaded content or credentials.

Status: `[x] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

Technical observation on 2026-07-14: the custom-provider custom adapter started as
the selected provider and proposal `prop-1784022747999-cpey7h9t4` produced
successful structured proposal and `SKILL.md` judgement events before finalize
returned `judged` with low risk. Persistence across a subsequent restart and
the remaining browser assertions still require operator acceptance.

Retest observation on 2026-07-14: proposal
`prop-1784027524931-vrxjd2qfe` persisted across restart with a completed
proposal judgement (`low`) and completed `SKILL.md` judgement (`medium`) from
the custom-provider adapter. The public aggregate correctly reported `medium`, the
original `HTTP/1.1` text remained stored, and upload finalization succeeded.
Manual browser confirmation of all rendered provider/time/result fields is
confirmed by the operator. Result reference:
`judge-2026-07-14-custom-provider-01`.

## JUDGE-04: Provider Failure And Retry

Begin with an invalid or unavailable provider, finalize one disposable upload,
then repair the provider settings and restart.

- [ ] Initial proposal/file states show `failed` and a safe message.
- [ ] A failed retry supersedes an older successful state in the UI.
- [ ] The proposal retry runs after provider repair and changes the state to
      `completed` without creating a new proposal.
- [ ] Each file can be retried independently and its result list is refreshed.
- [ ] Structured `judgement_execution` failure events expose only an error
      category, target identifiers, operation, and provider. Other request logs
      and API responses contain no credentials or provider payloads.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

## JUDGE-05: Converted Proposal Lifecycle

- [x] Convert the proposal to a draft skill version.
- [x] The proposal view immediately shows the created version selector and
      draft lifecycle actions without requiring `Enable editing`.
- [ ] Proposal and file retry controls remain available to reviewers.
- [ ] Re-running either judge keeps the proposal status `converted`.
- [ ] Submit Review, Approve, and Publish appear only for authorized roles and
      valid version states.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

Successful-path observation on 2026-07-14: proposal
`prop-1784027524931-vrxjd2qfe` converted to
`sample-custom-judger-skill@1.0.0`; conversion produced successful custom-provider
skill-version and `SKILL.md` judgement events. Submit Review, Approve, and
Publish each returned `200`. Converted-state retry behavior and independent
role-boundary identities remain pending before JUDGE-05 can pass.

## JUDGE-06: Publication Policy Matrix

Repeat with an approved disposable version that has missing/noop judgements.

- [ ] `disabled`: publish succeeds without a judgement gate.
- [ ] `warn`: publish succeeds and audit contains
      `publish_without_complete_judgement` with missing target IDs.
- [ ] `required`: publisher-only sessions receive `409 JUDGEMENT_REQUIRED`.
- [ ] `required`: administrators see the override dialog and must enter a
      non-empty reason.
- [ ] A successful override publishes and audit contains
      `publish_judgement_override` with the reason and missing targets.
- [x] `required`: publish succeeds without override once the skill version and
      every extractable file have real judgements.

Status: `[ ] PASS` `[ ] FAIL` `[ ] BLOCKED` `[ ] NOT RUN`

Successful required-policy observation on 2026-07-14:
`PUBLISH_JUDGEMENT_POLICY=required` allowed the fully judged
`sample-custom-judger-skill@1.0.0` normal publish path with `200`. Missing-result,
failed-result, warn/disabled, and audited override branches remain pending
before JUDGE-06 can pass.

## Result Post Template

```text
Scenario:
Status: PASS | FAIL | BLOCKED
Run ID:
Observed startup events:
Finalize judgementStatus:
Proposal state:
File states:
Visible lifecycle controls:
Publish result/status code:
Audit action names:
Sensitive evidence scan: PASS | FAIL
Unexpected behavior:
```
