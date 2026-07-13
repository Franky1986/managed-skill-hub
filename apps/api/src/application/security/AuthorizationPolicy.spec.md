# Authorization Policy Specification

## Purpose

`AuthorizationPolicy` is the only application component that maps verified
provider-neutral identity attributes to ManagedSkillHub roles and API-area
permissions.

## Rules

- HTTP adapters verify authentication and construct `AuthenticatedPrincipal`.
- Email, username, and display name never grant ownership or privileges.
- OIDC proposal access is granted to interactive humans according to
  `OIDC_PROPOSAL_ACCESS`; service identities are rejected.
- OIDC public-read access is granted according to `OIDC_PUBLIC_READ_ACCESS`.
- Reviewer, publisher, and admin roles come from configured stable subject IDs
  and exact group names.
- Admin grants are additive and imply all ManagedSkillHub roles.
- Existing anonymous and static-bearer adapters retain their configured route
  behavior without gaining admin roles.
- Controllers and use cases consume roles and stable principal IDs; they do not
  interpret provider groups or token claims.
