# Authentik OIDC Setup Playbook

## Status

The runtime implements the architecture from
[ADR-015](../decisions/ADR-015-authentik-oidc-and-delegated-agent-identity.md),
including OIDC admin login and independent `none`, `bearer`, or `oidc` agent
areas. Normal CI uses a deterministic local OIDC/JWKS provider.

Production activation remains gated on a real Authentik staging proof for the
target tenant and reverse proxy. Use `.env.example.authentik` for staging,
`.env.example.simple` for local or rollback operation, and
`.env.secrets.example` for the separate secret inventory. Do not remove the
activation warning from the Authentik profile until the real gate passes.

## Target Outcome

- Existing active human authentik users can authorize an agent without a local
  ManagedSkillHub account import.
- Every authenticated human may submit proposals by default.
- Any authenticated proposal user may read proposal status by a known UUID.
- Proposal mutations remain bound to the human who authorized the agent.
- Admin, reviewer, and publisher privileges are explicit.
- Published skill read auth remains independently configurable.
- No authentik password or OAuth token enters an agent conversation.

## Required Authentik Objects

Create these application/provider pairs:

| Object | Client type | Grant | Purpose |
|---|---|---|---|
| `managedskillhub-admin-web` | confidential | Authorization Code with PKCE | Admin browser login |
| `managedskillhub-agent-device` | public | Device Authorization | Human-delegated agent access |
| `managedskillhub-token-checker` | confidential | Token Introspection | Distinguish Authentik JWT access tokens from ID tokens |

Both providers must:

- use an asymmetric signing certificate;
- use `user_uuid` as subject mode;
- issue short-lived access tokens;
- expose only explicitly required scopes;
- use exact issuer values in ManagedSkillHub configuration;
- avoid Implicit and Password grants.

The agent provider has no client secret. Configure the token-checker provider
as a federated OAuth2/OpenID provider allowed to introspect tokens issued by
`managedskillhub-agent-device`. Admin and checker secrets belong in a deployment
secret manager and must never be committed.

## Groups

Create groups as privileges are introduced:

```text
managedskillhub-users
managedskillhub-readers
managedskillhub-submitters
managedskillhub-reviewers
managedskillhub-publishers
managedskillhub-admins
```

The initial proposal policy does not require
`managedskillhub-submitters`. With
`OIDC_PROPOSAL_ACCESS=all_authenticated_users`, all active interactive humans
accepted by the authentik application may submit and read proposal status by
known UUID.

Bind an authentik application policy that requires an active authenticated
human and rejects service accounts for the agent Device Flow. This preserves
the rule that an agent always submits on behalf of a human.

## Claims And Human Policy

Keep Authentik's default `profile` mapping or provide an equivalent Scope
Mapping that emits group names. Add a selected Scope Mapping to both providers
that returns at least:

```python
return {
    "managedskillhub_human": (
        request.user.is_active
        and request.user.type in ["internal", "external"]
    ),
    "groups": [group.name for group in request.user.ak_groups.all()],
}
```

Bind an application Expression Policy with the same active, non-service-account
condition. The policy is the provider-side authorization boundary; the boolean
claim is the API-side proof consumed through `OIDC_HUMAN_CLAIM`.

Verify the **access token** and ID token from one Token Endpoint response after
configuration. Scope mappings can add overlapping claims to both token classes,
so `aud`, `azp`, scopes, and custom claims alone do not distinguish them.

ManagedSkillHub supports two explicit validation modes:

- `OIDC_ACCESS_TOKEN_VALIDATION_MODE=jwt_profile` requires RFC 9068
  `typ=at+jwt` and rejects Authentik-style `typ=JWT`.
- `OIDC_ACCESS_TOKEN_VALIDATION_MODE=authentik_introspection` retains local
  signature, issuer, audience, `azp`, `uid`, time, scope, and human checks, then
  requires authenticated introspection to return `active=true`, the original
  device client ID, and the same subject. Use this mode when the target
  Authentik release emits `typ=JWT` for access tokens.

An ID token must fail both modes. Never switch to permissive `JWT` acceptance
without introspection.

## Existing User Population

No synchronization job is required. Authentik remains the user system of
record. ManagedSkillHub creates or updates a lightweight principal projection
only after a user completes a valid login.

Do not pre-copy passwords, usernames, or email addresses into ManagedSkillHub.
Ownership uses the authentik user UUID. Display name and email are mutable
profile attributes and are refreshed on later authentication.

## Device Code Flow

Authentik does not provide a default device-code stage configuration in every
installation. Configure it before creating the agent provider:

1. In authentik, create a flow with designation `Stage Configuration` and
   require authentication.
2. Configure that flow as the brand's default device-code flow.
3. Create `managedskillhub-agent-device` as a public OAuth2/OIDC provider.
4. Enable Device Authorization Grant only for the agent use case.
5. Configure `user_uuid` subject mode and asymmetric signing.
6. Configure the identity scopes `openid`, `profile`, and `email`, plus the
   custom API scopes `managedskillhub:discovery`,
   `managedskillhub:skills:read`, and `managedskillhub:proposals`. Bind
   Authentik policies so each scope is granted only under its configured access
   policy. The first implementation does not request `offline_access`.
7. Bind the active-human application policy.
8. Create `managedskillhub-token-checker` as a confidential provider, federate
   it for introspection of the device provider, and store its secret in
   `OIDC_INTROSPECTION_CLIENT_SECRET`.

Authentik's device endpoint returns `verification_uri_complete`. Agents show
that URL to the human and keep `device_code` secret. See the official
[authentik Device Code Flow](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/device_code/).

Agents request the base identity scopes plus only the area scopes required for
the current workflow. A proposal-only deployment does not need to grant
`managedskillhub:skills:read`.

## Admin Web Flow

1. Create `managedskillhub-admin-web` as a confidential OAuth2/OIDC provider.
2. Enable Authorization Code and require PKCE.
3. Register only the exact callback URL, for example
   `https://skills.example.com/api/admin/auth/oidc/callback`.
4. Configure `user_uuid` subject mode and asymmetric signing.
5. Set the required admin issuer, client ID, client secret, and callback URI in
   the deployment secret configuration.
6. Bootstrap at least one administrator through `OIDC_ADMIN_SUBJECTS` or assign
   a user to `managedskillhub-admins` before cutover.

ManagedSkillHub completes the token exchange server-side and creates its own
`HttpOnly`, `Secure` browser session. Access and refresh tokens are not returned
to the frontend.

## Access Policies

Recommended initial policy:

```env
DISCOVERY_AUTH_MODE=none
PUBLIC_READ_AUTH_MODE=none
PROPOSAL_AUTH_MODE=oidc
OIDC_PROPOSAL_ACCESS=all_authenticated_users
ADMIN_AUTH_MODE=oidc
```

This keeps published skills public while every valid human authentik user can
authorize proposal work. Later restriction requires only configuration and
group assignment:

```env
OIDC_PROPOSAL_ACCESS=required_groups
OIDC_PROPOSAL_GROUPS=managedskillhub-submitters
```

Published reads can independently use:

```env
PUBLIC_READ_AUTH_MODE=oidc
OIDC_PUBLIC_READ_ACCESS=all_authenticated_users
```

or:

```env
PUBLIC_READ_AUTH_MODE=oidc
OIDC_PUBLIC_READ_ACCESS=required_groups
OIDC_PUBLIC_READ_GROUPS=managedskillhub-readers
```

## Admin Bootstrap And Role Changes

Use stable authentik user UUIDs for initial admin bootstrap:

```env
OIDC_ADMIN_SUBJECTS=uuid-one,uuid-two
OIDC_ADMIN_GROUPS=managedskillhub-admins
OIDC_REVIEWER_GROUPS=managedskillhub-reviewers
OIDC_PUBLISHER_GROUPS=managedskillhub-publishers
```

Do not use usernames or email addresses for privileged allowlists. Environment
changes require a ManagedSkillHub restart. Agent group changes take effect with
the next access token. Admin roles are a snapshot in the local session and
therefore remain valid for at most `SESSION_TTL_SECONDS`; logout and login apply
changes immediately. Keep this TTL bounded for publisher and administrator
operations.

## ManagedSkillHub Configuration

For staging:

```bash
cp .env.example.authentik .env
cp .env.secrets.example .env.secrets
chmod 600 .env .env.secrets
```

Keep provider URLs, client IDs, scopes, policies, and role mappings in `.env`.
Set `OIDC_ADMIN_CLIENT_SECRET` and `OIDC_INTROSPECTION_CLIENT_SECRET` only in
`.env.secrets` or the deployment secret manager.

Replace every example host, callback URI, subject UUID, and secret. Confirm that
the configured issuers exactly match the `issuer` values in each provider's
OpenID configuration document.

The API must validate signature, issuer, audience, expiry, not-before time,
allowed algorithm, scopes, client identity, and token class. JWKS retrieval,
stream-bounded provider responses, introspection, and rotation fail closed.
Never weaken TLS verification to work around certificate errors.

`ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_PASSWORD_HASH`, and `JWT_SECRET` are not
used in OIDC mode and must be absent. `OIDC_ADMIN_CLIENT_SECRET` remains required
because the admin web client is confidential. Agent Device Authorization uses
the public client and has no client secret. Authentik JWT compatibility requires
the separate confidential introspection checker; its credential is never
returned to agents.

## Cutover Checklist

1. Patch authentik to a supported release and review current security
   advisories.
2. Create the device-code flow, providers, signing configuration, and policies.
3. Create or assign the initial admin identity.
4. Configure exact external API and callback URLs behind the trusted proxy.
5. Deploy OIDC-capable ManagedSkillHub code with the simple profile still
   active.
6. Prove agent Device Flow, admin login, logout, token expiry, and JWKS rotation
   in staging.
7. Switch `ADMIN_AUTH_MODE` and selected API areas to `oidc`.
8. Verify that the password login endpoint is disabled.
9. Verify that a normal authentik human can submit and read status by UUID.
10. Verify that another user can read status but cannot mutate the proposal.
11. Verify reviewer, publisher, and admin boundaries independently.
12. Remove obsolete local password secrets after the rollback window closes.

## Real Staging Gate

Create an evidence file from
`docs/setup/authentik-staging-evidence.example.json`. Use only a deployment
label and booleans; do not record identities, proposal UUIDs, tokens, or
secrets. Obtain a short-lived access token through the real Device Flow and run:

```bash
RUN_AUTHENTIK_STAGING_CHECK=true \
AUTHENTIK_STAGING_ACCESS_TOKEN='<short-lived-token>' \
AUTHENTIK_STAGING_ID_TOKEN='<matching-id-token>' \
AUTHENTIK_STAGING_EVIDENCE_FILE=/secure/path/authentik-staging-evidence.json \
./scripts/full-check.sh
```

The gate performs live admin and agent discovery, verifies Device Authorization
metadata, and validates the real access token with the production verifier. It
then independently validates the ID-token signature, issuer, client audience,
expiry, issued-at time, type, and subject before proving that this valid ID token
is rejected as an API access token. Both tokens must have the same subject.

If Authentik emits `at_hash`, the gate validates its cryptographic binding to
the access token. OIDC permits ID tokens returned by the Token Endpoint to omit
`at_hash`; in that case the operator must confirm
`tokensFromSameTokenResponse=true` in schema-v2 evidence. That confirmation is
provenance evidence, not a cryptographic binding. The evidence additionally
covers browser token absence, callback proxying, role boundaries, two-human
status/ownership behavior, session expiry, logout, key rotation, provider
outage, and rollback. Evidence expires after 30 days.

For activation, retain only the sanitized gate result: the access token must
pass, the independently valid same-subject ID token must fail as an access
token, and the result records `at_hash` or `same_subject` binding strength.
Never place either token in the evidence file.

## Rollback

Before removing simple-auth secrets, retain a time-bounded rollback procedure:

1. Restore `.env.example.simple`-compatible settings from the secret manager.
2. Set `ADMIN_AUTH_MODE=simple` and restore an independently generated password
   hash.
3. Set proposal/read modes to the previously proven `none` or `bearer` values.
4. Restart ManagedSkillHub and invalidate OIDC-created local sessions.
5. Record and investigate the reason for rollback.

Do not run simple and OIDC admin login as silent parallel fallbacks. A future
break-glass path requires a separate decision, explicit enablement, network
restriction, and audit events.

## Operational Security

- Monitor authentik advisories and apply identity-provider patches promptly.
- Rate-limit device authorization initiation and API proposal operations.
- Keep the agent access-token lifetime short; require a new linkout after
  expiry in the first implementation.
- Never log authorization headers, device codes, access tokens, client secrets,
  ID tokens, or session cookies.
- Review CORS, proxy trust, callback URLs, and cookie flags for every deployment.
- Treat proposal UUID knowledge as location only; every status request still
  requires a valid proposal-area credential when OIDC is enabled.
- Do not expose submitter email, internal principal IDs, audit records, or linked
  proposal UUIDs in non-admin proposal status responses.

Official references:

- [authentik OAuth2/OIDC provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/)
- [authentik Device Code Flow](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/device_code/)
- [authentik security advisories](https://github.com/goauthentik/authentik/security/advisories)
