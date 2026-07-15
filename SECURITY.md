# Security Policy

ManagedSkillHub is local-first infrastructure for skill governance and agent
consumption.

## Supported Versions

Security updates are evaluated continuously and applied on `main` as patches.
Until stable release governance is established, users should track the latest
`main` for fixes.

## Reporting A Vulnerability

Please do not report security issues in public issues. Submit reports through
[GitHub private vulnerability reporting](https://github.com/frankrichter/managed-skill-hub/security/advisories/new).
If GitHub private reporting is unavailable, contact the maintainer privately
through the profile linked in the repository before sharing vulnerability details.

Include:

- branch / commit
- exact steps to reproduce
- environment (OS, Node.js version)
- whether any secrets or credentials were exposed

## Sensitive Data Handling

This project intentionally stores local runtime data in `data/`.
Do not commit:

- `.env`
- `data/`
- token-bearing logs or diagnostics
- snapshots that include proposal/user artifacts

The repository `.gitignore` excludes common runtime files, but review staged
changes before publishing.
