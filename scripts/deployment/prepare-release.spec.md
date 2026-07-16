# Prepare Release Specification

## Purpose

Create reusable public deployment artifacts from a reviewed committed tree.

## Inputs

- `DEPLOY_OUTPUT_DIR`
- `DEPLOY_ARCHIVE_NAME`
- `DEPLOY_REQUIRE_CLEAN_TREE`
- `DEPLOY_RUN_CHECKS`
- `DEPLOY_RUN_BUILD`

## Contract

- A clean set of tracked and non-ignored untracked files is required by
  default.
- The normal repository check and production build run by default.
- The public archive is created from `HEAD`, never from untracked or ignored
  files.
- A portable SHA-256 checksum, the generic deployment-root `service.sh`, and
  its non-secret configuration example accompany the archive.
- Private overlays, real environment files, secrets, hostnames, nginx
  certificates, and custom private adapters are outside this script's scope.

## Checks

- `bash -n scripts/deployment/prepare-release.sh`
- `./scripts/check.sh`
