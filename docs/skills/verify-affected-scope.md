# Verify Affected Scope

First discover project-local verification gates in `AGENTS.md`, package scripts,
CI workflows, `scripts/check*`, `scripts/verify*`, `scripts/test*`, and the
relevant test directories. Record which commands are available and what they
prove. Run each applicable aggregate gate for the changed scope; focused tests
do not replace a repository-provided lifecycle, API-contract, migration,
security, or deployment proof.

For a TypeScript change, record the selected Git base and build the
verification scope from the committed branch diff, `git diff --cached`, `git
diff`, and relevant untracked files reported by `git status --short`. Review
and test that combined scope; do not limit a check to committed changes when
related staged, unstaged, or untracked work exists. Run `git diff --check` for
the branch, staged, and unstaged tracked views, then run the affected Vitest
files, `npm run test --workspaces`, workspace typecheck, lint, and production
build. Run `./scripts/check.sh` for cross-boundary changes. Record each command
and exit status. A failed workspace test must be rerun once in the same
environment and then in the affected test-file/package boundary; do not report
a green check from later proofs alone. For migrations, also run the migration
plan and backup/restore proof; document whether a real MySQL instance was
available. For changed security sinks, add a negative test that proves the raw
persisted representation excludes the sentinel value.
