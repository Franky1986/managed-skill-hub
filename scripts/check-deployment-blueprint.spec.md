# Deployment Blueprint Proof Specification

## Purpose

Prove that the public deployment helpers remain reusable across deployment
roots and do not acquire organization-specific assumptions.

## Coverage

- Installs `scripts/deployment/service.sh` into an isolated deployment root.
- Loads a non-default source directory and persistent secret-file path from
  `deployment.env`.
- Verifies `config` reports resolved non-secret settings.
- Verifies `status` reaches the runtime controller with the configured active
  release and secret file.
- Verifies `start` reaches the installation/start controller with the same
  environment.
- Verifies uploads with and without an explicit SSH port through a fake `scp`.
- Verifies option-like artifact names are normalized before `scp`.
- Verifies missing profiles, out-of-range ports, unsafe remote targets,
  parent traversal, and symbolic-link artifacts fail before networking.
- Verifies relative parent traversal, symbolic-link path components, and
  non-HTTP health URLs are rejected by the service controller.

Repository-specific confidential markers remain covered by the central public
release hygiene gate and its ignored operator denylist; this public proof does
not repeat or publish those marker values.

## Non-Scope

- SSH connectivity or remote mutation.
- Environment-specific overlays, nginx, certificates, custom adapters, or
  secrets.
- Full release cutover and rollback, which remain deployment-operator
  responsibilities.

## Checks

- `bash scripts/check-deployment-blueprint.sh`
- `./scripts/check.sh`
