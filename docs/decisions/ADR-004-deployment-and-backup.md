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
  - Server: the archive is validated and prepared in an isolated staging
    directory before `src/` is replaced; `data/` remains untouched.
  - Environment-specific wrappers may retain the previous release and restore
    it when application healthchecks or reverse-proxy validation fail.
- Public deployment helpers are organization-neutral and use operator-owned,
  non-secret profiles for SSH targets and deployment-root runtime paths.
- Internal hostnames, certificate paths, reverse-proxy details, custom private
  adapters, and real secrets remain outside the public repository.
- Server preparation installs the committed lockfile graph and creates
  production artifacts before stopping the active release.
- The stack starts in the background via `scripts/restart-server.sh`, with
  separate verified API and frontend PID files.
- Deployment startup uses built artifacts, waits for API and frontend HTTP
  health checks, and fails closed when either process is unhealthy.
- Stop/restart operations signal only recorded process trees whose working
  directory belongs to the deployed project; unknown listeners are not killed
  by port alone.
- No `rm -rf ./*` in the server root.

## Consequences

- Simple deployments without Docker or Kubernetes.
- Persistent data is protected.
- Build failures do not interrupt the active release.
- Failed cutovers can restore the previous application without changing
  persistent data.
- App update history remains traceable in archives.
- A later switch to systemd service or containers is possible.
- One public blueprint can support different server roots and SSH targets
  without forking application runtime scripts.

## Open Points

- Backup scheduling remains deployment-specific.
