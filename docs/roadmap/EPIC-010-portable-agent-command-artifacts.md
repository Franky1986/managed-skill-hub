# EPIC-010: Portable Agent Command Artifacts

## Status

Planned

## Objective

Make agent command files portable skill artifacts instead of leaking
submitter-workspace command paths such as `.cursor/commands/...` into skill
documentation.

Published skills should be consumable by different agent runtimes without
requiring the consumer agent to reconstruct command files from prose. When a
skill provides optional or required command shortcuts, those command artifacts
must be stored inside the skill package and mapped to the correct local
destination for Cursor, Codex, Claude Code, or future agent runtimes during
consumer-side installation.

## Problem Statement

Current proposal validation can classify `.cursor/commands/...` references as
non-blocking documentation-only external references. That is safe for upload
finalization, but it is not ideal product behavior:

- command references outside the skill root are not reproducible,
- consumers cannot deterministically install the command into their own agent
  runtime,
- agents may waste time rewriting Markdown to avoid validator findings,
- historical IDE/runtime paths remain visible in published content,
- the registry cannot distinguish "legacy documentation" from "this skill
  should ship a command shortcut".

The desired behavior is different: if a skill depends on, or benefits from, an
agent command, the command should be packaged as a portable artifact and the
consumer should receive deterministic installation guidance.

## Product Decision

Introduce a reserved package folder:

```text
commands/
```

The folder contains portable command definitions owned by the skill package.
These files are not installed blindly into `.cursor/`, `.codex/`, `.claude/`, or
other runtime-specific locations. Instead, the package includes enough metadata
for the consuming agent or setup script to copy or adapt the command to the
runtime selected by the user.

Initial package shape:

```text
skill-package/
  SKILL.md
  commands/
    README.md
    command-name.md
    manifest.json
  scripts/
  templates/
  examples/
```

`commands/manifest.json` is the portable command contract. It should be small,
textual, and reviewable.

Example:

```json
{
  "schemaVersion": "1.0",
  "commands": [
    {
      "id": "competitor-benchmark",
      "title": "Competitor Benchmark",
      "source": "commands/competitor-benchmark.md",
      "recommendedInvocation": "/competitor-benchmark",
      "runtimeTargets": [
        {
          "runtime": "cursor",
          "installHint": ".cursor/commands/competitor-benchmark.md"
        },
        {
          "runtime": "codex",
          "installHint": ".codex/commands/competitor-benchmark.md"
        },
        {
          "runtime": "claude-code",
          "installHint": ".claude/commands/competitor-benchmark.md"
        }
      ],
      "required": false
    }
  ]
}
```

The manifest describes target destinations as hints. The consumer agent must
still ask the user before writing outside the extracted skill directory.

Skill use, command installation, and registry publication are three separate
decisions:

- A user may use or download a published skill without installing any command
  shortcut.
- Installing a command into `.cursor/`, `.codex/`, `.claude/`, or another
  runtime folder requires separate user consent after the skill is selected.
- Portable commands belong to the same skill package by default. They do not
  require separate skill IDs or separate proposals.
- Command presence alone is not evidence that a new public proposal adds
  registry value. The skill still needs a distinct reusable purpose, and
  `SKILL.md` must remain the usable entrypoint when optional commands are not
  installed.

## Proposal Upload Contract

When a submitter package references runtime command paths outside the skill
root:

- If the command file exists outside the skill root and is relevant to the
  skill, the submitter agent should copy it into `commands/` in the temporary
  upload package.
- The submitter agent should rewrite references from runtime-specific paths
  such as `.cursor/commands/foo.md` to package-relative references such as
  `commands/foo.md`.
- The submitter agent should create or update `commands/manifest.json` with
  runtime target hints.
- If the outside-root command reference is only historical documentation, it may
  remain a non-blocking `external_reference` warning, but the agent should
  explain why it did not package the command.
- If `SKILL.md` requires a command to use the skill and the command is missing
  from `commands/`, validation should eventually become blocking.

If the submitted skill already contains a `commands/` folder, agents must treat
it as package content, not as a folder they may freely replace:

- Preserve existing `commands/` files unless they are clearly generated,
  duplicated, or unsafe.
- Inspect whether an existing command manifest is present:
  - `commands/manifest.json` following this registry convention,
  - a runtime-native manifest,
  - or plain command files without a manifest.
- If `commands/manifest.json` already exists and is valid, merge new command
  entries into it without removing existing entries.
- If a copied outside-root command would collide with an existing
  `commands/<name>` file, compare content:
  - identical content may be kept as-is,
  - conflicting content requires a new name or an explicit user decision before
    upload,
  - the agent must not silently overwrite an existing command.
- If the existing `commands/` folder uses a different runtime-specific
  convention, preserve it and add registry metadata only when it can be done
  without changing the original command semantics.
- If the existing `commands/` folder is ambiguous, stop before upload and ask
  whether commands should be treated as portable package artifacts,
  runtime-native files, or historical documentation.

Recommended collision-safe normalization:

```text
source package already has:
  commands/review.md

outside-root reference points to:
  .cursor/commands/review.md

agent behavior:
  1. compare both files if the outside-root file is readable
  2. keep commands/review.md if identical
  3. otherwise propose commands/review-cursor.md or ask the user
  4. update commands/manifest.json only after the collision is resolved
```

## Consumer Download Contract

After downloading `GET /skills/{skillId}/package?version=<published-version>`:

1. Extract the package to a user-approved location.
2. Verify `SKILL.md`, package manifest files, and `commands/manifest.json` if
   present.
3. Detect the user's intended agent runtime or ask them to choose.
4. Show the command files that would be installed and the target paths.
5. Ask for confirmation before writing outside the extracted skill directory.
6. Copy/adapt command files to the runtime-specific destination.
7. Run a post-check that verifies the installed command references the extracted
   skill package, not the original submitter workspace.

If the consumer does not want command installation, the skill remains
downloadable and usable through `SKILL.md`.

## Runtime Mapping

Initial runtime mappings are intentionally simple and file-based:

| Runtime | Target Hint |
|---------|-------------|
| Cursor | `.cursor/commands/<command>.md` |
| Codex | `.codex/commands/<command>.md` |
| Claude Code | `.claude/commands/<command>.md` |
| Generic | user-selected command folder |

The registry should not assume these paths are always correct. They are
defaults for generated setup guidance and can be overridden by the consuming
agent or user.

## API And Documentation Changes

Required contract updates:

- `/howToPropose` should explicitly mention `commands/` as a meaningful package
  subfolder.
- `/howToPropose` should tell agents to package relevant outside-root command
  files instead of leaving runtime-specific references in prose.
- `/discover` or a future package metadata endpoint should document portable
  command support once implemented.
- OpenAPI schemas should describe `commands/manifest.json` as an optional
  package-level convention.
- Agent bootstrap documentation should explain how consuming agents handle
  `commands/` after package download.

Potential later API:

```text
GET /skills/{skillId}/commands?version=<version>
```

This endpoint could expose command metadata without requiring a package
download, but it is not required for the first implementation.

## Validator Changes

The proposal validator should evolve from "warn about external command paths"
to "recommend portable command packaging":

- `.cursor/commands/...`, `.codex/commands/...`, and `.claude/commands/...`
  remain non-blocking when clearly historical.
- If a runtime command path appears in `SKILL.md` as an active setup or usage
  instruction and no matching `commands/` artifact exists, return a structured
  finding:

```json
{
  "kind": "portable_command_missing",
  "severity": "warning",
  "blocksFinalize": false,
  "candidate": ".cursor/commands/foo.md",
  "suggestedReplacement": "commands/foo.md"
}
```

- A later strict mode may make active required command references blocking.
- If `commands/manifest.json` exists, validate that every `source` path points
  to an uploaded package file.
- If `commands/manifest.json` references runtime target hints, treat those
  target hints as destination metadata, not missing package references.
- If a package contains command files but no `commands/manifest.json`, return a
  non-blocking `portable_command_manifest_missing` finding so agents can add
  metadata without blocking simple packages.
- If duplicate command IDs or duplicate `source` paths appear in
  `commands/manifest.json`, return a warning initially and consider making it
  blocking once the convention is stable.
- If `commands/manifest.json` is invalid JSON, lacks a `commands` array, or has
  `source` entries that do not point to uploaded files under `commands/`, return
  a non-blocking `portable_command_manifest_invalid` finding.

## Files Likely To Change

- `apps/api/src/adapters/inbound/http/skill-read.controller.ts`
- `apps/api/src/application/usecases/proposal/submit-proposal.usecase.ts`
- `apps/api/src/application/usecases/proposal/SubmitProposalUseCase.spec.md`
- `apps/api/src/adapters/inbound/http/SkillReadController.spec.md`
- `apps/api/src/adapters/inbound/http/ProposalController.spec.md`
- `packages/openapi/skill-registry.openapi.yaml`
- `docs/product/AGENT_BOOTSTRAP.md`
- `docs/product/AGENT_OPERATIONS.md`
- `scripts/check-agent-contract.ts`
- `scripts/check-skill-package-downloads.ts`

If consumer-side setup scripts are added, new scripts should be covered by
deterministic checks under `scripts/`.

## Risks And Open Questions

- Runtime paths differ by tool and version. Treat target paths as hints, not
  hard-coded truth.
- Command files can execute powerful agent workflows. Installation must require
  explicit user confirmation before writing into an agent runtime folder.
- Commands may contain local absolute paths, credentials, or internal references
  and need the same reference/secret scanning as other text artifacts.
- It is unclear whether commands should be versioned as ordinary skill files or
  also exposed as first-class metadata. Start with ordinary files plus manifest.
- Some agents may not support command files. The package must remain usable via
  `SKILL.md`.
- A generic manifest must avoid becoming a lowest-common-denominator runtime
  abstraction that hides important runtime-specific behavior.

## Acceptance Criteria

- Agent-facing proposal guidance describes `commands/` and portable command
  packaging.
- If a submitted package already contains `commands/`, guidance requires agents
  to preserve and merge rather than overwrite existing command artifacts.
- Proposal validation can identify runtime-specific command references and
  provide a `commands/` replacement suggestion.
- Proposal validation can identify existing command folders and manifest
  inconsistencies without breaking packages that only contain plain command
  files.
- Published package downloads preserve `commands/` files per version.
- Consumer guidance explains how to install commands into Cursor, Codex,
  Claude Code, or a user-selected generic folder.
- Command installation guidance never tells agents to write outside the
  extracted package without user confirmation.
- Deterministic checks cover proposal guidance and package download behavior
  for skills with and without `commands/`.
