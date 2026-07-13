# Judger Auto-Publish Matrix Check Script Spec

## Purpose

`scripts/check-judger-autopublish-matrix.ts` produces deterministic proof artifacts for the judgement and auto-publish safety matrix.

## Scope

The script validates disabled auto-publish, noop/not-judged blocking, explicit `AUTO_APPROVE_WITHOUT_JUDGER` override behavior, fully green deterministic judgement publishing, risky judgement blocking, and classifier failure handling. It uses deterministic in-memory fakes only and does not call real LLM providers.

## Outputs

- `.tmp/judger-autopublish-matrix.log`
- `.tmp/judger-autopublish-matrix.json`

Successful runs end with `RESULT=PASS`.
