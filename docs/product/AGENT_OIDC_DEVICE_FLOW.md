# Agent OIDC Device Flow Guide

## Status

This is the normative target guidance for agents after ADR-015 OIDC runtime
support is implemented. Current deployments advertise only `none` or static
`bearer` schemes. Agents must follow the scheme returned by `/discover` and
must not assume OIDC is available.

## Goal

Allow an agent to submit a proposal on behalf of a human without asking the
human for an authentik username, password, MFA code, access token, refresh
token, or client secret in conversation.

## Discovery

Start with `GET /discover`. When an API area uses OIDC Device Authorization,
discovery must provide enough non-secret metadata to start the flow:

- exact issuer and OpenID configuration URL;
- public agent client ID;
- Device Authorization endpoint;
- Token endpoint;
- explicit scopes for the requested API area;
- affected areas such as `proposal` or `public-read`;
- token expiry and reauthentication guidance.

The agent must use only HTTPS endpoints on the configured trusted authentik
origin. A client ID is public and may be returned by discovery. A client secret
must never be returned for the device client.

## Proposal Authorization Flow

1. Complete local proposal preflight before starting authentication when
   possible. This avoids asking the human to authenticate for an invalid
   package.
2. Request a device authorization from the advertised endpoint with the public
   client ID and exact proposal scopes.
3. Keep `device_code` in process memory. Never display, log, or persist it in
   proposal content.
4. Show the user `verification_uri_complete` as a clickable link. Also show
   `user_code` only as a fallback when the link cannot prefill it.
5. State the trusted authentik host in the message so the human can verify the
   destination before entering credentials.
6. Poll the token endpoint no faster than the returned `interval`.
7. Continue polling on `authorization_pending`.
8. Increase the interval as required on `slow_down`.
9. Stop on denial, expiry, invalid client, invalid scope, or an issuer mismatch.
10. After success, use the access token only in the Authorization header for
    the advertised ManagedSkillHub API area.
11. Do not use the ID token as an API bearer token.
12. After token expiry, start a new linkout. The first implementation does not
    request or retain `offline_access`.

Example user-facing message shape:

```text
To submit this proposal, authorize the agent through Company Authentik:
https://auth.example.com/...

Verify that the link opens auth.example.com. I will continue automatically
after authorization. Do not send credentials or tokens in this chat.
```

The link text may use the user's conversation language. Protocol field names,
API contracts, and agent instructions remain English.

## Identity And Ownership

A successful device flow identifies:

- the human subject who authorized the work;
- the public ManagedSkillHub agent client;
- the scopes granted for the operation.

Proposal creation and mutation use the stable human principal. A new agent
session authorized by the same human may continue an open proposal. Another
authenticated human may read status by known UUID when the deployment policy
allows it, but cannot change, finalize, or delete that proposal.

Agents must not send `X-Actor` as an identity assertion in OIDC mode. The API
derives the authoritative actor from the validated access token.

## Credential Handling

- Prefer in-memory access tokens.
- Never place tokens in normal chat messages, command output shown to the user,
  proposal files, generated documentation, telemetry, or error reports.
- Redact Authorization headers before logging HTTP requests.
- Do not store OAuth tokens in browser `localStorage` or `sessionStorage`.
- Do not ask the human to paste any token from authentik.
- Do not follow a Device Authorization link whose origin differs from the
  configured discovery issuer.

## Status Access

When `PROPOSAL_AUTH_MODE=oidc`, use the same proposal access token for duplicate
checks, creation, file upload, validation, finalization, deletion while open,
notices, and status polling.

Status-by-UUID access does not imply a list endpoint. Agents must not attempt to
enumerate proposal UUIDs. Non-admin status payloads must not be used to discover
other proposal IDs or personal uploader data.

## Failure Handling

| Error | Agent behavior |
|---|---|
| `authorization_pending` | Wait for the configured interval and poll again. |
| `slow_down` | Increase the interval before the next poll. |
| `access_denied` | Stop and tell the human authorization was declined. |
| `expired_token` | Start a new device flow only after explaining that the link expired. |
| `invalid_scope` | Stop; refresh discovery and report a registry configuration error. |
| API `401` after success | Refresh discovery once; never expose the token while reporting. |
| API `403` on mutation | Stop; the authenticated human is not the proposal owner or lacks the required role. |

Do not loop indefinitely. Respect the device-flow expiry and the user's explicit
denial or cancellation.

## Other Authentication Modes

- `none`: no linkout; follow the open-area contract.
- `bearer`: use an already configured static credential; never ask for it in
  chat.
- `oidc`: use the Device Authorization flow described here.

Authentication remains independent for discovery, published reads, proposals,
and admin access. A registry may therefore allow public skill reads while
requiring OIDC only for proposals.
