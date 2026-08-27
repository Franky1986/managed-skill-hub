import { describe, expect, it } from 'vitest';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';
import { buildGlobalJudgementTarget, findReusableJudgement, withJudgementInputFingerprint } from './judgement-input';

function target(description = 'A skill'): ReturnType<typeof buildGlobalJudgementTarget> {
  return buildGlobalJudgementTarget({ targetType: 'proposal', targetId: 'proposal-1', title: 'Example', description,
    category: 'automation', tags: ['tag-b', 'tag-a'], capabilities: ['read'], entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', role: 'entrypoint', mimeType: 'text/markdown', sizeBytes: 12, sha256: 'abc' }] });
}

describe('judgement input fingerprints', () => {
  it('is stable despite metadata ordering and reuses an unchanged judgement', () => {
    const input = target();
    const source = withJudgementInputFingerprint(Judgement.create({ targetType: 'proposal', targetId: 'proposal-1', model: 'test-model',
      dimensions: { safety: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' } } }), input, 'test');
    expect(findReusableJudgement(target(), [source], 'test')).toBe(source);
  });

  it('does not reuse a judgement when canonical input changes', () => {
    const input = target();
    const source = withJudgementInputFingerprint(Judgement.create({ targetType: 'proposal', targetId: 'proposal-1', model: 'test-model',
      dimensions: { safety: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' } } }), input, 'test');
    expect(findReusableJudgement(target('Changed'), [source], 'test')).toBeNull();
    expect(findReusableJudgement(input, [Judgement.create({ targetType: 'proposal', targetId: 'proposal-1', model: 'test-model',
      dimensions: { safety: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' } } })], 'test')).toBeNull();
  });
});
