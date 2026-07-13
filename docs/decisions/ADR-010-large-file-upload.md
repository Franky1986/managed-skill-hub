# ADR-010: Large Files Through Local Agent Preflight

## Status

Superseded by `GET /howToPropose` as canonical agent contract

## Context

Large or complex files such as Excel workbooks and PDF collections should not be
transferred in one single HTTP POST request.

## Decision

- Browser uploads in the MVP remain suitable for simple cases.
- For complex or larger proposal packages, no project-specific wrapper script
  is canonical anymore.
- Instead, `GET /howToPropose` describes the required local agent preflight:
  - package inspection
  - temporary normalization when needed
  - `SKILL.md` as root entrypoint
  - reference/self-contained check
  - secrets/PII check
  - duplicate precheck
- The local agent performs this workflow itself and then submits
  deterministically to the API.

## Consequences

- No product contract depends on a specific local shell tool anymore.
- Proposal upload is described consistently for different agent clients.
- UI upload remains available for simple cases.
