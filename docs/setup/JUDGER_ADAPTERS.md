# Judger Adapters

`managed-skill-hub` loads the judger implementation through `SkillJudgerPort`.
Custom provider modules are selected by combining a custom `JUDGER_PROVIDER`
identifier with `JUDGER_ADAPTER_PATH`.

## Built-in modes

- `noop`
  - No external service call.
  - Returns placeholder judgements with `overallRisk=no_judge_available` so operators can distinguish placeholder judgement from a real LLM judgement.
- `vercel-ai-sdk`
  - Uses local `VercelAiSdkSkillJudger` in `apps/api/src/adapters/outbound/judger/vercel-ai-sdk.judger.ts`.

For every other provider, set `JUDGER_ADAPTER_PATH` to a module implementing
`SkillJudgerPort`.

Built-in providers ignore `JUDGER_ADAPTER_PATH`. A contradictory development
configuration emits `judger_adapter_path_ignored`; production startup rejects
it so an operator cannot assume that a custom adapter is active when it is not.

## Add a custom Judger adapter

Set two environment variables:

```bash
JUDGER_PROVIDER=my-custom-judger
JUDGER_ADAPTER_PATH=./path/to/custom.adapter.ts
```

`my-custom-judger` can be any identifier and is passed as metadata to the adapter loader.
`JUDGER_ADAPTER_PATH` resolution:

- absolute path unchanged
- relative path against repository root
- extension fallback for module files (`.ts`, `.js`, `.mjs`, `.cjs`, `.mts`, `.cts`) when no extension is set

## Adapter Contract (agent-friendly)

### Input to `judge`

`judge` receives `JudgementTarget`:

```ts
{
  type: 'proposal' | 'skill' | 'file';
  id: string;
  title: string;
  text: string;
  metadata?: Record<string, unknown>;
}
```

The object maps to the target being judged:
- `proposal`: proposal UUID
- `skill`: skill ID
- `file`: file path or `${proposalId}:${path}`

### Output expected by `judge`

`judge` must return a `Judgement` instance with at minimum:

- `targetType`
- `targetId`
- `overallRisk`
- `summary`
- `dimensions`

`SkillJudgerPort` type and risk semantics:

```ts
type JudgementOverallRisk =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'no_judge_available';

type JudgementDimension = {
  risk: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  reason: string;
};

interface Judgement {
  targetType: 'proposal' | 'skill' | 'file';
  targetId: string;
  overallRisk: JudgementOverallRisk;
  summary: string;
  dimensions: Record<string, JudgementDimension>;
  skillPurposeSummary: string | null;
  model: string | null;
}
```

`overallRisk` can be `no_judge_available` when you intentionally do not perform automated judgement.
Keep this value strictly for transparent policy handling (for example auto-publish stays blocked unless explicitly allowed).

`classifyAutoPublishCategory(input)` is optional and only used for proposal auto-publish filtering.

### Suggested module exports

Adapter module can export one of:

- default object/class implementing `SkillJudgerPort`
- `createJudger(context)`
- `createSkillJudger(context)`
- `createSkillJudgerAdapter(context)`
- named class `SkillJudgerAdapter`

Context passed to factories/classes:

```ts
{
  provider: string;
  adapterPath: string;
  config: AppConfig;
}
```

### Adapter-specific configuration

ManagedSkillHub intentionally does not parse provider-specific host, token,
route, model, or procedure variables for custom adapters. Define a clear prefix
for your adapter and read those variables inside the adapter or its factory.
Keep only provider-neutral selection in the core configuration:

```bash
JUDGER_PROVIDER=my-custom-judger
JUDGER_ADAPTER_PATH=./path/to/custom.adapter.ts
MY_JUDGER_ENDPOINT=https://judger.example.com
MY_JUDGER_TOKEN=replace-me
```

Do not add transport-specific fields to `AppConfig`; this keeps custom adapters
replaceable without changing ManagedSkillHub.

## Minimal example

```ts
import {
  SkillJudgerPort,
  JudgementTarget,
} from '../../application/ports/outbound/judger.port';
import { Judgement } from '../../domain/judgement/Judgement';

const adapter: SkillJudgerPort = {
  async judge(target: JudgementTarget): Promise<Judgement> {
    return Judgement.create({
      targetType: target.type,
      targetId: target.id,
      summary: 'Rule-based custom adapter verdict',
      model: 'custom:example',
      overallRisk: 'low',
      skillPurposeSummary: target.type === 'skill' ? `Skill purpose: ${target.title}.` : null,
      dimensions: {
        harmful: {
          risk: 'low',
          score: 0.1,
          reason: 'No obvious harmful pattern found.',
        },
        policyViolation: {
          risk: 'low',
          score: 0.05,
          reason: 'No policy violation flagged.',
        },
      },
    });
  },
};

export default adapter;
```

## Next step

- Restart API after adding the file and setting `JUDGER_PROVIDER` and `JUDGER_ADAPTER_PATH`.
- Verify the startup log contains the intended provider and no
  `judger_adapter_path_ignored` warning.
- Finalized proposals expose an execution state for the proposal and every
  file: `not_started`, `completed`, `unavailable`, or `failed`. Reviewers can
  retry the proposal or an individual file without changing a terminal
  `converted` or `rejected` proposal state.
- Set `PUBLISH_JUDGEMENT_POLICY=required` when publication must be blocked until
  the skill version and every extractable file have a real judgement. `warn`
  audits and continues; `disabled` omits this publication check.
- Keep `SkillJudgerPort` as the only dependency between application logic and judge transport.
