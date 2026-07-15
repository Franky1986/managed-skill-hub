# Spec: DuplicateCheckUseCase (Application)

## Purpose

Provides a safe public metadata/fingerprint preflight and a separate internal,
content-aware duplicate assessment for finalized proposals.

## Scope

- `execute(input)` is the public preflight and accepts only metadata and optional
  file fingerprints. It never accepts a proposal ID or reads stored content.
- `executeForProposal(proposal)` is the internal review/auto-publish boundary for
  a finalized, already loaded proposal aggregate.
- Calculates a content digest when SHA-256 checksums for files are available.
- Finds exact duplicates through `contentDigest` in proposals and published
  skills.
- Checks whether an explicit `skillId` already references an existing skill.
- Calculates heuristic similarity against open proposals and published skills.
- The internal path may enrich up to three published-skill candidates with the
  optional semantic judger; unpublished candidate proposal content is never sent.
- The current proposal ID is excluded from exact and heuristic proposal matches.
- Returns ranked similar matches with differences: tags, capabilities,
  entrypoint, title/description.
- Returns `resolutionOptions` that the agent can present to the user:
  - new skill with automatically suggested skill ID,
  - new draft version of an existing skill,
  - request admin update of an existing skill.

## Non-Scope

- No blocking of submissions. The result is informational only.
- No file-content reads or semantic judger calls on the public path.
- No reading unpublished drafts or admin-only skills.

## Responsibilities

- Normalize metadata: trim, lowercase tags/capabilities/category/skillId.
- Calculate content digest only when file fingerprints are present.
- Determine exact duplicates preferably from SQLite catalog projection.
- Calculate similarity using Jaccard similarity over tokenized words in
  title/description and sets for tags/capabilities.
- Consider exact category match as bonus weight.
- Return top 5 matches with score >= 0.25.
- Consider at most three heuristic candidates with score >= 0.4 for semantic
  enrichment, and invoke those comparisons once in one bounded batch.
- Report semantic execution as `not_required`, `completed`, or `unavailable`.
- Prepare differences per match so agent or admin can decide.

## Inputs / Outputs

- Public input: `DuplicateCheckInputDto` with skillId, title, description, category,
  tags, capabilities, entrypoint, files
- Internal input: finalized `Proposal`
- Output: `DuplicateCheckResultDto` with `submittedContentDigest`,
  `exactDuplicateProposalId`, `exactDuplicateSkillId`, `similarMatches`,
  `skillIdCollision`, `resolutionOptions`, `note`

## Dependencies

- `SkillCatalogPort`

## Failure Modes

- Invalid `skillId` -> `skillIdCollision` reports invalidity, no thrown error
- Catalog unavailable -> `StorageError` from adapter
- Internal semantic provider/content read failure -> `semanticCheck.status = unavailable`;
  auto-publish must treat this as manual-review-required.

## Acceptance Criteria

- `POST /proposals/check-duplicate` returns `exactDuplicateProposalId` or
  `exactDuplicateSkillId` for identical content.
- Without file fingerprints, `submittedContentDigest` is `null`.
- Similar matches contain a score between 0 and 1 plus `matchedOn` and
  `differences`.
- Collision with an existing `skillId` is returned as a hint.
- On collision or duplicate, `resolutionOptions` are returned for the agent to
  present to the user.
- The use case does not block submissions.
- The public endpoint cannot select or expose stored proposal content through an
  arbitrary identifier.
- Internal semantic comparison uses only the submitted proposal entrypoint and
  published skill entrypoints.

## Tests / Checks

- Use-case tests for exact duplicates, skill-ID collision, and similarity
  ranking.
- `./scripts/check.sh`
