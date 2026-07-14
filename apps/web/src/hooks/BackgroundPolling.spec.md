# Spec: Background Polling (Web)

## Purpose

Keep proposal-related navigation and active proposal views current without
full-page reloads or visible loading-state flicker.

## Behavior

- Polling runs immediately and then every 10 seconds while its view is mounted
  and enabled.
- At most one request per polling task is active at a time.
- Route, filter, or dependency changes abort the previous request before the
  replacement task starts.
- Background failures preserve the last successfully rendered data.
- Component unmount aborts the current request and clears the timer.
- The shared interval applies to the open-proposal navigation count, admin
  proposal list, admin proposal detail, and public proposal status view.

## Guardrails

- Polling must not clear server data before a successful replacement arrives.
- Polling must not reset selection, scroll position, expanded artifacts, or
  other local interaction state.
- Authentication and authorization failures remain governed by the existing
  API client and route guards.

## Checks

- Web lint, typecheck, and tests
- Admin UI source smoke proof
- Production build
