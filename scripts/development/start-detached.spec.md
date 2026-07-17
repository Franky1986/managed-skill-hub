# Spec: Detached Development Process Launcher

## Purpose

Start the local development stack in an independent process group so it remains
running after the invoking shell exits and can be stopped as one managed tree.

## Contract

- Accept a log-file path followed by a command and its arguments.
- Spawn the command in the current working directory with the current
  environment.
- Redirect stdin from nowhere and redirect stdout/stderr to the managed log
  file, replacing the previous startup log.
- Create a detached process group and print only its leader PID after spawn.
- Exit non-zero when the command cannot be spawned.

## Guardrails

- Never interpolate a shell command string.
- Never print environment values.
- The caller owns PID persistence, readiness checks, and process termination.
