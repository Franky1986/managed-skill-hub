# Deployment Service Control Specification

## Purpose

Provide one reusable deployment-root command for starting, stopping,
inspecting, and diagnosing an installed ManagedSkillHub release.

## Configuration

The script resolves its deployment root from its own location unless
`MANAGED_SKILL_HUB_DEPLOYMENT_ROOT` overrides it. It optionally loads the
regular, non-symlink file selected by
`MANAGED_SKILL_HUB_DEPLOYMENT_CONFIG`, defaulting to `deployment.env` beside
the installed script. The deployment root is canonicalized physically before
managed child paths are validated, so platform-level aliases such as macOS
`/var` do not create false positives.

Supported non-secret settings:

- `MSH_SOURCE_DIR`
- `MSH_SECRETS_FILE`
- `MSH_START_SCRIPT`
- `MSH_RUNTIME_SCRIPT`
- `MSH_LOG_FILE`
- `MSH_API_HEALTH_URL`
- `MSH_FRONTEND_HEALTH_URL`

Relative paths resolve below the deployment root and may not contain parent
traversal. Absolute paths are allowed for operators that keep releases or
secrets on separate mounted storage. Every existing path component is checked;
symbolic links are rejected even when the final file itself is regular.

## Actions

- `start` and `restart` start the compiled API and built frontend through the
  active release's `install_and_start.sh start` path.
- `stop` and `status` delegate to the active release's safe PID-based runtime
  controller.
- `health` checks both configured loopback HTTP endpoints.
- `logs` follows the combined runtime log.
- `config` prints resolved non-secret paths and health URLs.
- No argument defaults to `status`.

## Security And Safety

- The active source directory, secret file, runtime scripts, and optional
  configuration must be regular non-symlink entries reached without traversing
  any symbolic-link path component.
- Process-changing and process-inspection actions require the active source,
  runtime script, and secret file. `health`, `logs`, and `config` retain their
  narrower diagnostic prerequisites.
- Secret values are never printed.
- Runtime commands always export both the active release root and persistent
  secret-file path.
- Health URLs must use HTTP or HTTPS and are separated from `curl` options.
- Unknown actions fail without changing processes.

## Checks

- `bash -n scripts/deployment/service.sh`
- Isolated `status` and `config` tests use a temporary deployment root.
- Parent traversal and symbolic links in intermediate path components are
  rejected deterministically.
- `./scripts/check.sh` verifies that the script remains executable.
