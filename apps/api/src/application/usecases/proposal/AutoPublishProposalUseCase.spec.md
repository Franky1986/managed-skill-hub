# Spec: AutoPublishProposalUseCase

## Purpose

Evaluate whether a finalized proposal may be published automatically and, when
eligible, run the existing convert/review/publish workflow with distinct audit
entries.

## Scope

- auto-publish eligibility for finalized proposals
- duplicate/manual blocker checks
- fully-green judgement aggregation
- excluded-category classifier gate
- automatic convert/review/publish orchestration
- audit visibility for evaluation, success, and failure

## Non-Scope

- proposal upload itself
- manual admin review workflow
- later re-judge-triggered automation

## Responsibilities

- Respect `AUTO_PUBLISH_ON_GREEN`.
- Block incomplete uploads.
- Block duplicate-content proposals/skills.
- Run exactly one internal duplicate assessment after judgement gates are green.
- Block exact duplicates and skill-ID collisions, and require manual review when
  similarity reaches the configured threshold.
- Fail closed with `manual_review_required` when semantic duplicate enrichment
  was required but unavailable.
- Block proposals that already saw manual admin intervention.
- Require a fully green proposal-level judgement and fully green latest
  judgements for every judgable proposal file.
- Treat `JUDGER_PROVIDER=noop` and `overallRisk = no_judge_available` as non-real judgement by default for auto-publish, unless `AUTO_APPROVE_WITHOUT_JUDGER=true` is explicitly set.
- Run the excluded-category classifier only when automation is enabled and
  judgement gates are green.
- Fail closed when the classifier is unavailable, times out, or returns invalid
  output.
- On positive eligibility, convert the proposal, submit the created version for
  review, approve it, and publish it with a distinct automation actor.
- Persist `evaluate_auto_publish`, `auto_publish_proposal`, and
  `auto_publish_failed` audit events as applicable.

## Acceptance Criteria

- Disabled automation returns `eligible = null` and does not try to publish.
- Category classifier blockers return `blockedReason = category_blocked`.
- Classifier failures return `blockedReason = classifier_failed`.
- Non-green or missing judgements return `blockedReason = non_green_judgement`.
- Successful automation creates a published skill version and records a
  dedicated auto-publish audit entry.
- Duplicate assessment is invoked at most once per auto-publish evaluation.

## Tests / Checks

- Focused use-case tests for allow/block paths
- `./scripts/check.sh`
