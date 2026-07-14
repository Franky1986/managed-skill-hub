# Public Release Hygiene Check Script Spec

## Purpose

`scripts/check-public-release-hygiene.sh` catches accidental publication of runtime secrets, private/internal adapter references, missing repository metadata, and tracked environment files before a public release.

## Scope

The script checks:

- Required public metadata files exist.
- Runtime `.env` and `.env.secrets` files are not tracked.
- The tracked `.env.secrets.example` contains names and blank values only.
- Obvious secret-looking values are absent from tracked public files.
- Internal/private judger implementation paths are not tracked publicly.
- Public docs do not advertise private service setup.
- Untracked commit candidates are scanned together with tracked files.
- Tracked-but-ignored files fail the release gate.
- Private adapter, helper, deployment, environment, conversation-link, and
  transport markers are absent from every reachable Git commit.
- Private environment examples and deploy preparation artifacts remain ignored.

## Outputs

- `.tmp/public-release-hygiene.log`
- `.tmp/public-release-hygiene.json`

Successful runs end with `RESULT=PASS`.
