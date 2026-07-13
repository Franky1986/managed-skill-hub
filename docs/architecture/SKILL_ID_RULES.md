# SKILL_ID_RULES

Skill IDs must be globally unique and slug-style.

## Rules

- Only lowercase letters (`a-z`), numbers (`0-9`), and hyphens (`-`).
- Minimum length: 3 characters.
- Recommended maximum length: 64 characters.
- No leading or trailing hyphens.
- No consecutive hyphens.
- Should be descriptive, for example `angular-testing-standards`.

## Examples

- Valid: `angular-testing`, `customer-support-email`, `adr-generator-v2`
- Invalid: `AngularTesting`, `angular__testing`, `-angular-testing`, `angular-testing-`, `ab`

## Namespacing Convention

- Namespacing will later be represented with hyphens.
- Examples: `frontend-angular-testing`, `backend-nestjs-standards`, `product-user-stories`.
