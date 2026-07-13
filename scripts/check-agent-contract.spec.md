# Agent Contract Check Script Spec

## Purpose

`scripts/check-agent-contract.ts` validates that the agent-facing discovery and
proposal guidance stay internally consistent across open and proposal-protected
runtime profiles.

## Scope

The script validates:

- /discover exposes registry identity, proposal entrypoints, and published skill
  package download entrypoints.
- /howToPropose includes current upload/finalization/package guidance.
- Credential setup URLs and first-step instructions appear only when agent auth
  is enabled.
- The generated setup script contains no bearer-token secret values and renders
  only fields required by the current runtime profile.
- Agent bootstrap documentation references discovery/proposal guidance and warns
  agents not to ask users to paste bearer tokens into chat.

## Outputs

- `.tmp/agent-contract.log`
- `.tmp/agent-contract.json`

Successful runs end with `RESULT=PASS`.
