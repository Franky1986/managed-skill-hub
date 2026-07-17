# Generate Admin Password Hash Script Spec

## Purpose

Generate a BCrypt value for `ADMIN_PASSWORD_HASH` without exposing the plain
password in process arguments or shell history.

## Inputs

- The password and its confirmation are read silently from standard input.
- `BCRYPT_ROUNDS` optionally selects a cost between 4 and 31; the default is 12.
- The repository dependency `bcryptjs` must be installed.

## Output

- Standard output contains only the generated BCrypt hash and a trailing newline.
- Prompts and errors are written to standard error.
- Operators must single-quote the hash when assigning it in a shell-sourced
  `.env.secrets` file because BCrypt values contain `$` characters.

## Guardrails

- Empty or mismatched passwords fail without producing a hash.
- Invalid cost values fail before reading a password.
- The password is passed to Node.js through standard input, never a command-line
  argument.

## Checks

- `bash -n scripts/security/generate-admin-password-hash.sh`
- `./scripts/check.sh` verifies that the helper remains executable.
