# Public Release Hygiene Check Script Spec

## Purpose

`scripts/checks/check-public-release-hygiene.sh` catches accidental publication of runtime secrets, private/internal adapter references, missing repository metadata, and tracked environment files before a public release.

## Scope

The script checks:

- Required public metadata files exist.
- Runtime `.env` and `.env.secrets` files are not tracked.
- The tracked `.env.secrets.example` contains names and blank values only.
- Obvious secret-looking values are absent from tracked public files.
- Internal/private judger implementation paths are not tracked publicly.
- Public docs do not advertise private service setup.
- Public files and reachable history do not reference internal adapter source
  paths.
- An optional ignored denylist can scan confidential identifiers without
  publishing those identifiers in the repository. `PUBLIC_RELEASE_STRICT=1`
  requires this denylist before a release decision.
- Untracked commit candidates are scanned together with tracked files.
- Strict release mode fails when any non-ignored untracked file remains, so
  private archives or scratch files cannot sit unnoticed beside the public
  checkout.
- Tracked-but-ignored files fail the release gate.
- Private adapter, helper, deployment, environment, conversation-link, and
  transport markers are absent from every reachable Git commit.
- The checker excludes both its current hierarchical path and its historical
  top-level path from history-reference matching because those files
  necessarily contain the detection expressions themselves.
- Private environment examples and legacy private deploy-preparation artifacts
  remain ignored; the public deployment archive script is tracked and required.

## Outputs

- `.tmp/public-release-hygiene.log`
- `.tmp/public-release-hygiene.json`

Successful runs end with `RESULT=PASS`.

## Confidential Denylist

The default denylist path is `.public-release-denylist`; operators may override
it with `PUBLIC_RELEASE_DENYLIST_FILE`. The file contains one case-insensitive
extended regular expression per line. Blank lines and lines beginning with `#`
are ignored. The file must remain ignored and must never be committed.

Normal CI can run without the confidential denylist. A public release decision
must use strict mode:

```bash
PUBLIC_RELEASE_STRICT=1 bash scripts/checks/check-public-release-hygiene.sh
```

Strict mode fails when the denylist is missing, empty, or matches the current
repository content or any reachable Git revision. Match details are not copied
into proof logs, preventing the gate itself from republishing confidential
identifiers.
