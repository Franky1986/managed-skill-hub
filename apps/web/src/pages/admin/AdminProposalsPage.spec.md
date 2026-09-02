# Spec: Admin Proposals Page

## Purpose

Provide a continuously refreshed review queue with explicit lifecycle filters.

## Contract

- The visible lifecycle filters are ordered `in_upload`, `review`, `rejected`,
  `converted`, and `all`. The transient `submitted` state is intentionally not
  exposed as a separate admin filter. The `review` filter requests judged and
  approved proposals that need a human decision or conversion.
- Filter counts refresh through the shared non-overlapping background poller.
  The `All` count is independently fetched as the number of grouped converted
  skill names, so it updates even while a different filter is selected.
- Review count includes both judged and approved proposals; in-upload,
  rejected, and converted remain separate lifecycle buckets. `All` is a
  versioned-proposal overview: it excludes uploads and rejected proposals,
  groups converted versions by target skill, shows the skill's latest published
  version in the group header, and keeps converted proposal versions in its
  collapsed history. Within a group, conversion audit versions sort
  semantically newest-first even if their proposal timestamps are out of
  order. `Converted` remains a chronological flat list.
- Transient polling failures keep the last successful list and count visible.
- Converted proposals remain available as individual chronological entries.
- Converted entries show the immutable version created by conversion, not the
  live conversion preview's next version. The latter remains available only
  for proposals that have not yet been converted.

## Tests

- Filter-to-status mapping and visible-filter order
- Review count and empty-bucket behavior
- Versioned-proposal grouping, newest-version selection, and collapsed history
- Shared background polling source-contract check
