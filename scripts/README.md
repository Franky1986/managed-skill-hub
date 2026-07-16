# Script Layout

The repository keeps stable top-level commands for developers, CI, and
existing automation. New reusable implementation code is grouped by concern.

## Stable Entrypoints

| Area | Commands |
|------|----------|
| Baseline validation | `check.sh`, `full-check.sh` |
| Local development | `restart-all.sh`, `smoke-test.sh`, `start-mysql-stack.sh` |
| Server runtime | `install_and_start.sh`, `restart-server.sh` |
| Release and deployment | `create-deploy-archive.sh`, `deployment/` |
| Backup and restore | `backup.sh`, `restore.sh` |
| Content migration | `migrate-*.ts`, `export-*.ts` |
| Deterministic proofs | `check-*.ts`, their co-located `*.spec.md` files |
| Shared helpers | `load-env.sh`, `run-with-env.sh`, `script-app-config.ts` |

Top-level commands remain intentionally stable because CI, roadmap evidence,
documentation, and external operator automation reference them.

## Deployment Blueprint

`deployment/` contains organization-neutral building blocks:

- `prepare-release.sh` creates the committed public archive, checksum, and
  generic service controller.
- `upload.sh` uploads an explicit artifact list using an operator-owned
  non-secret profile.
- `service.sh` is installed at the deployment root and provides
  `start|restart|stop|status|health|logs|config`.
- `deployment.env.example` configures an installed service controller.
- `upload-profile.env.example` configures an upload target.

Environment-specific overlays, private adapters, certificate paths, internal
hostnames, and real deployment profiles must remain ignored or live in a
separate private operations repository.

## Architectural Boundary

These scripts are delivery, operations, migration, and proof tooling. They are
outside the Domain and Application layers and may orchestrate public
application ports and adapters. They must not become an alternate location for
business rules, direct unmanaged writes to `data/`, or provider-specific domain
behavior.

## Future Organization

The deterministic `check-*` suite is deliberately left at stable paths for
now. A later mechanical migration may move implementations below `checks/`
while retaining small compatibility entrypoints until CI, documentation, and
external consumers have migrated.
