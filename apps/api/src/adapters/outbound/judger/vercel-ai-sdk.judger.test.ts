import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JudgerProtocolError, JudgerTimeoutError, JudgerUnavailableError, ValidationError } from '../../../domain/errors';
import { VercelAiSdkSkillJudger } from './vercel-ai-sdk.judger';
import * as aiSdk from 'ai';

vi.mock('ai', () => {
  return {
    Output: {
      object: vi.fn().mockImplementation((options: { schema: unknown }) => ({ objectSchema: options.schema })),
    },
    generateText: vi.fn(),
  };
});

vi.mock('@ai-sdk/openai', () => ({
  openai: (modelId: string) => ({ id: `openai:${modelId}` }),
}));

describe('VercelAiSdkSkillJudger', () => {
  const generateText = vi.mocked(aiSdk.generateText);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls generateText with shared prompts and maps the structured output', async () => {
    generateText.mockResolvedValue({
      output: {
        summary: 'Looks okay overall.',
        skillPurposeSummary: 'Reviews local video workflows.',
        dimensions: {
          harmful: { risk: 'low', score: 0, reason: 'No harmful content.' },
          promptInjection: { risk: 'medium', score: 0.4, reason: 'Hidden instruction found.' },
          dataExfiltration: { risk: 'low', score: 0, reason: 'No data leakage.' },
          policyViolation: { risk: 'low', score: 0, reason: 'No policy violation.' },
          qualityFit: { risk: 'low', score: 0, reason: 'Content fits the target purpose.' },
        },
      },
    });

    const judger = new VercelAiSdkSkillJudger({
      model: 'openai:gpt-4.1',
      timeoutMs: 30000,
      maxTextChars: 12000,
      maxRetries: 0,
    });

    const judgement = await judger.judge({
      type: 'proposal',
      id: 'proposal-1',
      title: 'Proposal test',
      text: 'Please review this proposal',
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    const calledWith = generateText.mock.calls[0]?.[0];
    expect(calledWith).toMatchObject({
      model: expect.any(Object),
      system: expect.stringContaining('risk judger'),
      prompt: expect.stringContaining('Target type: proposal'),
      maxRetries: 0,
    });
    expect((calledWith as { abortSignal?: AbortSignal }).abortSignal).toBeDefined();
    expect((calledWith as { output?: object }).output).toBeDefined();
    expect(judgement.targetId).toBe('proposal-1');
    expect(judgement.model).toBe('vercel-ai-sdk:openai:gpt-4.1');
    expect(judgement.skillPurposeSummary).toBe('Reviews local video workflows.');
    expect(judgement.overallRisk).toBe('medium');
    expect(judgement.dimensions.promptInjection.reason).toContain('Hidden instruction');
  });

  it('fails fast for unsupported model providers', () => {
    expect(
      () =>
        new VercelAiSdkSkillJudger({
          model: 'anthropic:claude-3',
          timeoutMs: 30000,
          maxTextChars: 12000,
          maxRetries: 0,
        })
    ).toThrow(ValidationError);
  });

  it('maps transport timeout to JudgerTimeoutError', async () => {
    const timeoutError = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    generateText.mockRejectedValue(timeoutError);

    const judger = new VercelAiSdkSkillJudger({
      model: 'openai:gpt-4.1',
      timeoutMs: 100,
      maxTextChars: 12000,
      maxRetries: 0,
    });

    await expect(
      judger.judge({
        type: 'file',
        id: 'file.txt',
        title: 'file.txt',
        text: 'abc',
      })
    ).rejects.toBeInstanceOf(JudgerTimeoutError);
  });

  it('passes configured timeout and maxRetries to generateText', async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);

    generateText.mockResolvedValue({
      output: {
        summary: 'Looks okay overall.',
        dimensions: {
          harmful: { risk: 'low', score: 0, reason: 'No harmful content.' },
          promptInjection: { risk: 'medium', score: 0.4, reason: 'Hidden instruction found.' },
          dataExfiltration: { risk: 'low', score: 0, reason: 'No data leakage.' },
          policyViolation: { risk: 'low', score: 0, reason: 'No policy violation.' },
          qualityFit: { risk: 'low', score: 0, reason: 'Content fits the target purpose.' },
        },
      },
    });

    const judger = new VercelAiSdkSkillJudger({
      model: 'openai:gpt-4.1',
      timeoutMs: 12000,
      maxTextChars: 12000,
      maxRetries: 2,
    });

    await judger.judge({
      type: 'file',
      id: 'file.txt',
      title: 'File text',
      text: 'abc',
    });

    const calledWith = generateText.mock.calls[0]?.[0];
    expect(timeoutSpy).toHaveBeenCalledWith(12000);
    expect(calledWith).toMatchObject({
      maxRetries: 2,
    });
  });

  it('maps structured output issues to JudgerProtocolError', async () => {
    generateText.mockRejectedValue(new Error('Schema validation failed'));

    const judger = new VercelAiSdkSkillJudger({
      model: 'openai:gpt-4.1',
      timeoutMs: 30000,
      maxTextChars: 12000,
      maxRetries: 0,
    });

    await expect(
      judger.judge({
        type: 'skill',
        id: 'skill-a:1.0.0',
        title: 'Skill',
        text: 'content',
      })
    ).rejects.toBeInstanceOf(JudgerProtocolError);
  });

  it('maps provider runtime failures to JudgerUnavailableError', async () => {
    generateText.mockRejectedValue(new Error('Service unavailable'));

    const judger = new VercelAiSdkSkillJudger({
      model: 'openai:gpt-4.1',
      timeoutMs: 30000,
      maxTextChars: 12000,
      maxRetries: 0,
    });

    await expect(
      judger.judge({
        type: 'skill',
        id: 'skill-a:1.0.0',
        title: 'Skill',
        text: 'content',
      })
    ).rejects.toBeInstanceOf(JudgerUnavailableError);
  });
});
