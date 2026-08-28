# Verify Affected Scope

For a TypeScript change, record the selected Git base and build the
verification scope from the committed branch diff, `git diff --cached`, `git
diff`, and relevant untracked files reported by `git status --short`. Review
and test that combined scope; do not limit a check to committed changes when
related staged, unstaged, or untracked work exists. Run `git diff --check` for
the branch, staged, and unstaged tracked views, then run the affected Vitest
files, workspace typecheck, lint, and production build. Run
`./scripts/check.sh` for cross-boundary changes. For migrations, also run the
migration plan and backup/restore proof; document whether a real MySQL instance
was available. For changed security sinks, add a negative test that proves the
raw persisted representation excludes the sentinel value.
