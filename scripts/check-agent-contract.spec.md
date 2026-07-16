# Agent Contract Check Script Spec

## Purpose

`scripts/check-agent-contract.ts` validates that the agent-facing discovery and
proposal guidance stay internally consistent across open and proposal-protected
runtime profiles.

## Scope

The script validates:

- /discover exposes registry identity, proposal entrypoints, and published skill
  package download entrypoints.
- `/discover` and `/howToPropose` expose matching HTTP-client guidance that
  distinguishes discovery, search, and package download.
- The guidance explains that local network/VPN execution context, rather than
  `curl` itself, can determine whether an internal registry is reachable.
- Authentication diagnosis is endpoint- and area-specific and does not infer
  public-read authentication from `/admin/session` or another endpoint.
- Discovery, public-read, and proposal authorization flags match the active
  runtime profile, and curl examples identify the applicable auth area without
  embedding credentials.
- /howToPropose includes current upload/finalization/package guidance.
- Agent-session discovery and first-step instructions appear only when bearer
  agent auth is enabled.
- The retired credential setup URL/route is absent.
- Agent bootstrap documentation references discovery/proposal guidance and warns
  agents not to ask users to paste bearer tokens into chat.

## Outputs

- `.tmp/agent-contract.log`
- `.tmp/agent-contract.json`

Successful runs end with `RESULT=PASS`.
