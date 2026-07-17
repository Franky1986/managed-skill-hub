# check-admin-ui-smoke.ts Spec

## Purpose

Provide a lightweight deterministic smoke proof that browser-facing admin and public UI contracts remain wired to the current API and runtime configuration expectations.

## Scope

The proof is source-contract based and does not require a browser driver. It is intended for `./scripts/check.sh` and `./scripts/full-check.sh`.

## Validated Behavior

- Public Explore/Search/How-to/Proposal-status routes stay outside the admin route guard.
- Admin routes stay behind `AdminRoute` and redirect anonymous users to `/admin/login`.
- Primary admin navigation entries are gated by `isAuthenticated`.
- Admin login, session refresh, logout, and logout redirect are wired.
- How-to-propose auth guidance is config-aware and tells users never to paste
  bearer tokens into chat.
- Auth error copy can expose the affected auth area and safe recommendation
  without exposing tokens.
- Proposal detail and judgement UI distinguish `no_judge_available` / not-judged states.
- Admin proposal review, draft/conversion, and proposal-decision refresh paths are reachable from the UI source.
- Proposal navigation, admin list/count/detail, and public status views use the shared
  non-overlapping 10-second background poller with request cancellation.

## Artifacts

- `.tmp/admin-ui-smoke.log`
- `.tmp/admin-ui-smoke.json`

## Non-Goals

- Pixel rendering or screenshot comparison.
- End-to-end browser automation; this can be added later if a browser test dependency is introduced.
- Backend authorization behavior; HTTP auth is covered by other proof scripts.
