# Groups

Skills can be assigned to one or more groups.

## Properties

- Groups are free-form strings.
- The MVP does not define fixed enums.
- Recommended conventions: `frontend`, `backend`, `product`, `security`, `architecture`, `devops`.
- A skill can belong to multiple groups.

## Usage

- Search filter: `GET /skills/search?group=frontend`
- Display in the UI and admin area.
- Agents can filter for groups intentionally.

## Maintenance

- Groups are maintained in the skill manifest under `groups`.
- The MVP does not include central group management.
