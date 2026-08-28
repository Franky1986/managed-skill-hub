import { expect, it } from 'vitest';
import { SafeExternalSkillJudger } from './safe-external-judger';
import { JudgerUnavailableError } from '../../../domain/errors';

it('categorizes an arbitrary external adapter sentinel without retaining its message or name', async () => {
  const judger = new SafeExternalSkillJudger({
    async judge() { throw Object.assign(new Error('SENTINEL_PROVIDER_RESPONSE'), { name: 'SENTINEL_PROVIDER_ERROR' }); },
  });
  await expect(judger.judge({ type: 'skill', id: 'skill', title: 'skill', text: 'text' }))
    .rejects.toEqual(expect.objectContaining({ name: JudgerUnavailableError.name, message: 'External judger request failed' }));
});

it('does not expose optional capabilities for a judge-only adapter', () => {
  const judger = new SafeExternalSkillJudger({
    async judge() { throw new Error('not used'); },
  });

  expect(judger.classifyAutoPublishCategory).toBeUndefined();
  expect(judger.assessDuplicateSimilarity).toBeUndefined();
});
