import { mkdir, writeFile } from 'node:fs/promises';
import { Proposal, ProposalFile } from '../apps/api/src/domain/proposal/Proposal';
import { Judgement, JudgementRisk, NO_JUDGE_AVAILABLE_RISK } from '../apps/api/src/domain/judgement/Judgement';
import { AutoPublishProposalUseCase } from '../apps/api/src/application/usecases/proposal/auto-publish-proposal.usecase';

type CaseId =
  | 'disabled-green'
  | 'noop-autopublish-without-override'
  | 'noop-autopublish-with-override'
  | 'green-autopublish'
  | 'risky-autopublish'
  | 'classifier-throws'
  | 'classifier-blocks'
  | 'classifier-missing';

interface CaseDefinition {
  id: CaseId;
  judgement: 'green' | 'noop' | 'risky';
  enabled: boolean;
  autoApproveWithoutJudger: boolean;
  classifier: 'allow' | 'throw' | 'block' | 'missing';
  expected: {
    enabled: boolean;
    autoPublished: boolean;
    blockedReason: string | null;
  };
}

const cases: CaseDefinition[] = [
  {
    id: 'disabled-green',
    judgement: 'green',
    enabled: false,
    autoApproveWithoutJudger: false,
    classifier: 'allow',
    expected: { enabled: false, autoPublished: false, blockedReason: null },
  },
  {
    id: 'noop-autopublish-without-override',
    judgement: 'noop',
    enabled: true,
    autoApproveWithoutJudger: false,
    classifier: 'allow',
    expected: { enabled: true, autoPublished: false, blockedReason: 'non_green_judgement' },
  },
  {
    id: 'noop-autopublish-with-override',
    judgement: 'noop',
    enabled: true,
    autoApproveWithoutJudger: true,
    classifier: 'allow',
    expected: { enabled: true, autoPublished: true, blockedReason: null },
  },
  {
    id: 'green-autopublish',
    judgement: 'green',
    enabled: true,
    autoApproveWithoutJudger: false,
    classifier: 'allow',
    expected: { enabled: true, autoPublished: true, blockedReason: null },
  },
  {
    id: 'risky-autopublish',
    judgement: 'risky',
    enabled: true,
    autoApproveWithoutJudger: false,
    classifier: 'allow',
    expected: { enabled: true, autoPublished: false, blockedReason: 'non_green_judgement' },
  },
  {
    id: 'classifier-throws',
    judgement: 'green',
    enabled: true,
    autoApproveWithoutJudger: false,
    classifier: 'throw',
    expected: { enabled: true, autoPublished: false, blockedReason: 'classifier_failed' },
  },
  {
    id: 'classifier-blocks',
    judgement: 'green',
    enabled: true,
    autoApproveWithoutJudger: false,
    classifier: 'block',
    expected: { enabled: true, autoPublished: false, blockedReason: 'category_blocked' },
  },
  {
    id: 'classifier-missing',
    judgement: 'green',
    enabled: true,
    autoApproveWithoutJudger: false,
    classifier: 'missing',
    expected: { enabled: true, autoPublished: false, blockedReason: 'classifier_failed' },
  },
];

function judgement(kind: CaseDefinition['judgement'], targetType: 'proposal' | 'file', targetId: string): Judgement {
  if (kind === 'noop') {
    return Judgement.create({
      targetType,
      targetId,
      dimensions: lowDimensions('noop placeholder'),
      overallRisk: NO_JUDGE_AVAILABLE_RISK,
      summary: 'No judgement was performed by a real LLM.',
      model: 'noop',
    });
  }
  if (kind === 'risky') {
    return Judgement.create({
      targetType,
      targetId,
      dimensions: {
        ...lowDimensions('ok'),
        promptInjection: { risk: JudgementRisk.MEDIUM, score: 0.4, reason: 'suspicious instruction handling' },
      },
      summary: 'Risky deterministic judgement.',
      model: 'deterministic-risky',
    });
  }
  return Judgement.create({
    targetType,
    targetId,
    dimensions: lowDimensions('ok'),
    summary: 'Green deterministic judgement.',
    model: 'deterministic-green',
  });
}

function lowDimensions(reason: string) {
  return {
    harmful: { risk: JudgementRisk.LOW, score: 0, reason },
    promptInjection: { risk: JudgementRisk.LOW, score: 0, reason },
    dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason },
    policyViolation: { risk: JudgementRisk.LOW, score: 0, reason },
    qualityFit: { risk: JudgementRisk.LOW, score: 0, reason },
  };
}

function proposalFor(testCase: CaseDefinition): Proposal {
  const proposalId = 'proposal-' + testCase.id;
  return Proposal.create({
    id: proposalId,
    title: 'Deterministic Auto Publish Skill',
    description: 'Fixture proposal for EPIC-008 auto-publish proof.',
    category: 'productivity',
    tags: ['proof'],
    capabilities: ['validate'],
    entrypoint: 'SKILL.md',
    submittedBy: 'agent',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })
    .addFile(ProposalFile.create({
      id: 'SKILL.md',
      path: 'SKILL.md',
      mimeType: 'text/markdown',
      sizeBytes: 128,
      sha256: 'sha256-' + testCase.id,
    }))
    .finalizeUpload()
    .addJudgement(judgement(testCase.judgement, 'proposal', proposalId))
    .addJudgement(judgement(testCase.judgement, 'file', proposalId + ':SKILL.md'));
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(message + '. Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

async function runCase(testCase: CaseDefinition) {
  const proposal = proposalFor(testCase);
  const auditEntries: unknown[] = [];
  let convertCalls = 0;
  let publishCalls = 0;
  const useCase = new AutoPublishProposalUseCase(
    {
      findProposalById: async () => proposal,
    } as never,
    {
      readProposalFile: async () => ({ mimeType: 'text/markdown', content: Buffer.from('# fixture') }),
    } as never,
    {
      append: async (entry: unknown) => { auditEntries.push(entry); },
      findByProposalId: async () => [],
    } as never,
    {
      scan: async () => ({ text: '# fixture', metadata: {} }),
    } as never,
    (testCase.classifier === 'missing'
      ? {
          judge: async () => judgement('green', 'proposal', 'unused'),
        }
      : {
          judge: async () => judgement('green', 'proposal', 'unused'),
          classifyAutoPublishCategory: async () => {
            if (testCase.classifier === 'throw') {
              throw new Error('deterministic classifier failure');
            }
            if (testCase.classifier === 'block') {
              return { blocked: true, matchedCategory: 'network', reason: 'deterministic category block', model: 'deterministic-classifier' };
            }
            return { blocked: false, matchedCategory: null, reason: 'deterministic allow', model: 'deterministic-classifier' };
          },
        }) as never,
    {
      convertProposal: async () => {
        convertCalls += 1;
        return {
          id: { toString: () => 'deterministic-auto-published-skill' },
          getAllVersions: () => [{ version: '1.0.0' }],
        };
      },
    } as never,
    {
      submitForReview: async () => undefined,
      approve: async () => undefined,
      publish: async () => { publishCalls += 1; },
    } as never,
    {
      enabled: testCase.enabled,
      excludedCategories: ['security', 'network'],
      autoApproveWithoutJudger: testCase.autoApproveWithoutJudger,
      similarityThreshold: 0.5,
    },
    {
      getProposal: async () => null,
      findProposalByContentDigest: async () => null,
      findPublishedSkillByContentDigest: async () => null,
    } as never
  );

  const result = await useCase.execute(proposal.id);
  assertEqual(result.enabled, testCase.expected.enabled, testCase.id + ' enabled');
  assertEqual(result.autoPublished, testCase.expected.autoPublished, testCase.id + ' autoPublished');
  assertEqual(result.blockedReason, testCase.expected.blockedReason, testCase.id + ' blockedReason');
  assertEqual(convertCalls > 0, testCase.expected.autoPublished, testCase.id + ' convert calls');
  assertEqual(publishCalls > 0, testCase.expected.autoPublished, testCase.id + ' publish calls');

  return {
    id: testCase.id,
    judgement: testCase.judgement,
    enabled: testCase.enabled,
    autoApproveWithoutJudger: testCase.autoApproveWithoutJudger,
    classifier: testCase.classifier,
    result,
    auditEntries: auditEntries.length,
    convertCalls,
    publishCalls,
    passed: true,
  };
}

async function main(): Promise<void> {
  const results = [];
  for (const testCase of cases) {
    results.push(await runCase(testCase));
  }

  const report = {
    name: 'judger-autopublish-matrix',
    totalPermutations: cases.length,
    passedPermutations: results.length,
    failedPermutations: 0,
    results,
  };
  const lines = [
    'judger-autopublish-matrix',
    'totalPermutations=' + report.totalPermutations,
    'passedPermutations=' + report.passedPermutations,
    'failedPermutations=' + report.failedPermutations,
    ...results.map((result) => [
      'PASS',
      result.id,
      'judgement=' + result.judgement,
      'enabled=' + result.enabled,
      'autoApproveWithoutJudger=' + result.autoApproveWithoutJudger,
      'autoPublished=' + result.result.autoPublished,
      'blockedReason=' + (result.result.blockedReason ?? '-'),
      'convertCalls=' + result.convertCalls,
    ].join(' ')),
    'RESULT=PASS',
  ];

  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/judger-autopublish-matrix.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/judger-autopublish-matrix.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
