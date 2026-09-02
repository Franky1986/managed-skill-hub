# Spec: SkillDetailPage

## Purpose

Render the public, latest-published view of a skill and provide a clear path to
the protected admin workbench for version-level management.

## Admin Workbench Entry

The public skill detail renders an `Open admin workbench` link for the same
canonical skill id. When a latest published version exists, the link includes
it as the `version` query parameter so the workbench opens that exact version.
The admin route remains protected by the normal session and role guards; the
public page never exposes unpublished content or grants an admin capability.

## Version Lifecycle Boundary

The public detail serves only the latest published version. The admin
workbench is the place to inspect other versions and perform lifecycle actions.
`deprecated` remains a terminal lifecycle state; reversible disable/enable
semantics are not implemented by this page or the current domain model.
