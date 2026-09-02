# Spec: Admin Review Queue Page

## Purpose

Provide the single admin queue for skill-version work after proposal conversion.

## Contract

- The queue owns draft, in-review, approved, and rejected skill versions; it
  replaces the former separate drafts page.
- `Active` includes drafts, versions in review, and approved versions awaiting
  publication. `All` includes those states plus rejected versions, but excludes
  published and deprecated versions.
- Each filter button shows a count derived from the complete refreshed skill
  list. The page polls this list through the shared non-overlapping background
  poller, so counts remain current without changing filters.
- The proposal shortcut opens the proposal review filter directly.

## Tests

- Draft inclusion in active/all filters
- Per-filter count derivation
