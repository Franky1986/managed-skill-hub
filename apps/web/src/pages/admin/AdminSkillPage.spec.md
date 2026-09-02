# Spec: AdminSkillPage

## Proposal Context Navigation

When a reviewer opens an admin skill through a proposal-context URL, the page
shows a prominent link to the canonical admin skill route without proposal
context parameters. The link carries the selected skill version as `version`,
specifically the version created by that proposal rather than its reference
version, so the normal version-review workflow exposes its approval or
publication actions.

The link is shown only when proposal context and a skill id are present. A
valid `version` query parameter takes precedence over the default version
selection for that skill.

## Asynchronous Operation Feedback

The workbench renders the durable operation state and, while distinct, its
current worker phase. A terminal operation whose state and phase are both
`completed` is shown once rather than as duplicate completion text.

The proposal shortcut that finalizes and publishes a proposal stores the
returned publish operation in the page state. The workbench therefore polls
the queued publication, refreshes the selected version after completion, and
does not claim publication succeeded before the asynchronous operation has
completed.
