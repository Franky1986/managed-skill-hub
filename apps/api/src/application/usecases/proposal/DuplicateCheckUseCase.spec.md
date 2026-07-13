# Spec: DuplicateCheckUseCase (Application)

## Purpose

Allows agents to check before proposal submission whether identical or similar
content already exists as a proposal or published skill.

## Scope

- `execute(input)` accepts metadata and optional file fingerprints.
- Calculates a content digest when SHA-256 checksums for files are available.
- Finds exact duplicates through `contentDigest` in proposals and published
  skills.
- Checks whether an explicit `skillId` already references an existing skill.
- Calculates similarity between submitted metadata and existing proposals/skills.
- Returns ranked similar matches with differences: tags, capabilities,
  entrypoint, title/description.
- Returns `resolutionOptions` that the agent can present to the user:
  - new skill with automatically suggested skill ID,
  - new draft version of an existing skill,
  - request admin update of an existing skill.

## Non-Scope

- No blocking of submissions. The result is informational only.
- No direct file-content comparison; only file fingerprints: sha256 + path.
- No reading unpublished drafts or admin-only skills.

## Responsibilities

- Normalize metadata: trim, lowercase tags/capabilities/category/skillId.
- Calculate content digest only when file fingerprints are present.
- Determine exact duplicates preferably from SQLite catalog projection.
- Calculate similarity using Jaccard similarity over tokenized words in
  title/description and sets for tags/capabilities.
- Consider exact category match as bonus weight.
- Return top 5 matches with score >= 0.25.
- Prepare differences per match so agent or admin can decide.

## Inputs / Outputs

- Input: `DuplicateCheckInputDto` with skillId, title, description, category,
  tags, capabilities, entrypoint, files
- Output: `DuplicateCheckResultDto` with `submittedContentDigest`,
  `exactDuplicateProposalId`, `exactDuplicateSkillId`, `similarMatches`,
  `skillIdCollision`, `resolutionOptions`, `note`

## Dependencies

- `SkillCatalogPort`

## Failure Modes

- Invalid `skillId` -> `skillIdCollision` reports invalidity, no thrown error
- Catalog unavailable -> `StorageError` from adapter

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

## Tests / Checks

- Use-case tests for exact duplicates, skill-ID collision, and similarity
  ranking.
- `./scripts/check.sh`
