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

The proposal shortcut that finalizes and publishes starts one durable workflow
operation immediately, displays conversion, review-submission, approval, and
publication phases while polling it, refreshes the selected version after
completion, and does not claim publication succeeded before completion.

If that operation stops because a judgement override reason is required, the
override dialog retries the same proposal operation with the supplied reason.
It must not route through a version-only publish action, because the proposal
view may still hold the pre-conversion state while the durable operation has
already created the target version.
