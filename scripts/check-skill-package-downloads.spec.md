# Skill Package Downloads Check Script Spec

## Purpose

`scripts/check-skill-package-downloads.ts` proves that published skill packages
can be consumed deterministically by agents without reconstructing file contents
from chat output.

## Scope

The script validates:

- Explicit single-file published version download returns `SKILL.md` directly.
- Latest multi-file published version download returns a ZIP package.
- ZIP entries are deterministic, relative, and traversal-safe.
- Explicit draft/unpublished versions are not publicly downloadable.
- Unknown skills are not downloadable.

It uses in-memory Fastify injection and deterministic fixture data. It must not
read or mutate committed `data/skills/` content.

## Outputs

Successful runs write:

- `.tmp/skill-package-downloads.log`
- `.tmp/skill-package-downloads.json`

A successful run must include:

```text
skill-package-downloads
totalChecks=4
passedChecks=4
failedChecks=0
RESULT=PASS
```

## Failure Behavior

Any mismatch exits non-zero. `scripts/check.sh` runs this script and reports
`.tmp/skill-package-downloads.check.log` plus the proof artifact path on
failure.
