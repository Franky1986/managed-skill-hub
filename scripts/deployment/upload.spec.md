# Deployment Upload Specification

## Purpose

Upload an explicit artifact set to a configured deployment root without
embedding one organization's server names or paths in the public script.

## Profile

The operator-owned profile supplies:

- `DEPLOY_REMOTE_HOST`
- `DEPLOY_REMOTE_USER`
- `DEPLOY_REMOTE_DIR`
- optional `DEPLOY_SSH_PORT`

The remote directory must be absolute. The profile is trusted shell
configuration and must not contain secret values. Host, user, directory, and
port values are restricted to forms that cannot become additional `scp`
options or remote-shell syntax. The helper exposes its canonical public
`PROJECT_ROOT` while sourcing an ignored profile so a private overlay can
reference other ignored local files without relying on caller-exported state.

## Contract

- Every artifact must be an explicit regular non-symlink file.
- Artifact paths are normalized to absolute physical-parent paths before they
  are passed to `scp`, so names beginning with `-`, whitespace, and line
  wrapping cannot turn them into options or split them.
- Upload works with or without the optional SSH port on the repository's
  supported Bash baseline.
- The script uploads only; it never executes remote commands or changes a
  running deployment.

## Checks

- `bash -n scripts/deployment/upload.sh`
- Successful uploads with and without an explicit port are covered through a
  deterministic fake `scp`.
- Invalid profiles, out-of-range ports, unsafe remote values, parent traversal,
  and symbolic-link artifacts fail before `scp`.
