# Agent Contract Check Script Spec

## Purpose

`scripts/checks/check-agent-contract.ts` validates that the agent-facing discovery and
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
- Discovery and proposal guidance expose the same versioned sequential state
  machine, enforce one active proposal id per upload intent, advertise
  `PROPOSAL_UPLOAD_ALREADY_OPEN` recovery, and require the parsed validation
  gate before finalization.
- JSON workflow guidance preserves response bodies instead of using `curl -f`
  and forbids a single chained lifecycle command.
- `/categories` declares an open policy, published values as suggestions, and
  support for custom categories rather than presenting an allowlist.
- /howToPropose includes current upload/finalization/package guidance.
- `/howToPropose` exposes a mandatory outside-root artifact decision gate that
  keeps services such as Figma external, requires concrete packaging proposals
  for local commands/references/assets, and waits for the user's explicit
  include/external/remove choice before proposal creation.
- Agent-session discovery and first-step instructions appear only when bearer
  agent auth is enabled.
- The retired credential setup URL/route is absent.
- Agent bootstrap documentation references discovery/proposal guidance and warns
  agents not to ask users to paste bearer tokens into chat.
- Agent bootstrap documentation requires status/validation recovery on the
  existing proposal id instead of opening a parallel upload after uncertainty.

## Outputs

- `.tmp/agent-contract.log`
- `.tmp/agent-contract.json`

Successful runs end with `RESULT=PASS`.
