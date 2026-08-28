import { describe, expect, it } from 'vitest';
import { BoundedSkillJudger } from './bounded-skill-judger';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';

describe('BoundedSkillJudger', () => {
  it('does not execute more than its configured number of judgements concurrently', async () => {
    let active = 0; let maximum = 0;
    const judger = new BoundedSkillJudger({ async judge(target) {
      active += 1; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1;
      return Judgement.create({ targetType: target.type, targetId: target.id, model: 'test',
        dimensions: { safety: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' } } });
    } }, 2);
    await Promise.all([0, 1, 2, 3].map((id) => judger.judge({ type: 'file', id: String(id), title: String(id), text: '', metadata: {} })));
    expect(maximum).toBe(2);
  });
});
