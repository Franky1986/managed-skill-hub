# ADR-004: Deployment And Backup

## Status

Accepted

## Context

The project should run on an internal server under
`/path/to/deploy-root`. App code must be replaceable, while all skill data
must survive redeploys.

## Decision

- `/path/to/deploy-root/src/` contains app code and is rolled out fresh
  for every deploy.
- `/path/to/deploy-root/data/` contains skills, uploads, index, audit log,
  and backups, and remains untouched during redeploys.
- Deployment follows a staged archive rollout pattern:
  - Local: `scripts/create-deploy-archive.sh` creates a `tar.gz` archive from the committed tree.
  - Server: the archive is extracted, `src/` is replaced, and `data/` remains.
- In the MVP, the stack starts in the background via `scripts/restart-server.sh`
  (`nohup`, PID file).
- No `rm -rf ./*` in the server root.

## Consequences

- Simple deployments without Docker or Kubernetes.
- Persistent data is protected.
- App update history remains traceable in archives.
- A later switch to systemd service or containers is possible.

## Open Points

- Healthcheck endpoint and deploy validation must be added.
- Backup script must run regularly.
