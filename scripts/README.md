# Script Layout

Repository automation is grouped by responsibility. Only the two validation
orchestrators remain at the `scripts/` root because they are stable developer
and CI entrypoints.

## Stable Entrypoints

| Command | Purpose |
|---------|---------|
| `./scripts/check.sh` | Deterministic baseline validation |
| `./scripts/full-check.sh` | Extended smoke, MySQL, and environment-specific validation |

## Responsibility Directories

| Directory | Ownership |
|-----------|-----------|
| `checks/` | Deterministic proof implementations and their co-located specs |
| `content/` | Content migration, export, and environment-layout migration |
| `deployment/` | Release archives, installation, runtime control, upload, and service integration |
| `development/` | Local stack lifecycle, smoke testing, and the local MySQL stack |
| `lib/` | Shared shell and TypeScript helpers; no standalone business workflows |
| `operations/` | Backup and restore operations |
| `security/` | Local credential and secret preparation helpers |

Specs remain beside the implementation they define. New scripts must be added
to the narrowest matching directory instead of returning to the root.
The baseline check rejects newly tracked root-level script implementations.
Ignored operator-local helpers are outside this public layout contract.

## Deployment Blueprint

`deployment/` contains organization-neutral building blocks:

- `prepare-release.sh` creates the committed public archive, checksum, and
  generic service controller.
- `upload.sh` uploads an explicit artifact list using an operator-owned
  non-secret profile.
- `service.sh` is installed at the deployment root and provides
  `start|restart|stop|status|health|logs|config`.
- `install_and_start.sh` and `restart-server.sh` own application preparation
  and runtime process control inside an extracted release.
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
