# Spec: Admin Proposals Page

## Purpose

Provide a continuously refreshed review queue with explicit lifecycle filters.

## Contract

- The `open` filter requests submitted/judged/approved review states and excludes
  unfinished uploads.
- Filter counts come from `ProposalNotice` and refresh through the shared
  non-overlapping background poller.
- Open count copy shows submitted/judged breakdown; in-upload and converted remain
  separate lifecycle buckets.
- Transient polling failures keep the last successful list and count visible.
- Converted proposals are not labelled as open in the global navigation.

## Tests

- Filter-to-status mapping
- Open count breakdown and empty/single-bucket behavior
- Shared background polling source-contract check
