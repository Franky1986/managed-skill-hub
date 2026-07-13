import { describe, expect, it } from 'vitest';
import {
  buildJudgementSystemPrompt,
  buildJudgementUserPrompt,
  parseJudgementOutput,
} from './judgement-contract';
import { JudgerProtocolError } from '../../../domain/errors';

describe('judgement-contract', () => {
  it('builds provider-neutral judgement prompts', () => {
    const systemPrompt = buildJudgementSystemPrompt();
    const userPrompt = buildJudgementUserPrompt(
      {
        type: 'skill',
        id: 'skill-a:1.0.0',
        title: 'Skill A',
        text: 'x'.repeat(12),
        metadata: { category: 'test' },
      },
      5
    );

    expect(systemPrompt).toContain('harmful');
    expect(systemPrompt).toContain('promptInjection');
    expect(systemPrompt).toContain('qualityFit');
    expect(systemPrompt).toContain('send me money');
    expect(userPrompt).toContain('Target type: skill');
    expect(userPrompt).toContain('"category": "test"');
    expect(userPrompt).toContain('[TRUNCATED 7 CHARS]');
  });

  it('parses and normalizes judgement output', () => {
    const output = parseJudgementOutput(
      JSON.stringify({
        summary: '  Review summary  ',
        skillPurposeSummary: '  Helps edit local videos safely.  ',
        dimensions: {
          harmful: { risk: 'low', score: -1, reason: 'ok' },
          promptInjection: { risk: 'medium', score: 2, reason: 'hidden instruction' },
          dataExfiltration: { risk: 'high', reason: 'asks for secrets' },
          policyViolation: { risk: 'critical', score: 1, reason: 'blocked' },
          qualityFit: { risk: 'medium', score: 0.5, reason: 'unprofessional unrelated text' },
        },
      }),
      'test-judger'
    );

    expect(output.summary).toBe('Review summary');
    expect(output.skillPurposeSummary).toBe('Helps edit local videos safely.');
    expect(output.dimensions.harmful.score).toBe(0);
    expect(output.dimensions.promptInjection.score).toBe(1);
    expect(output.dimensions.dataExfiltration.score).toBe(0.66);
    expect(output.dimensions.qualityFit.reason).toContain('unprofessional');
  });

  it('rejects incomplete judgement output', () => {
    expect(() =>
      parseJudgementOutput(
        {
          summary: 'Incomplete',
          dimensions: {
            harmful: { risk: 'low' },
          },
        },
        'test-judger'
      )
    ).toThrow(JudgerProtocolError);
  });
});
