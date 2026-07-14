import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JudgerProtocolError, JudgerTimeoutError, JudgerUnavailableError, ValidationError } from '../../../domain/errors';
import { VercelAiSdkSkillJudger } from './vercel-ai-sdk.judger';
import * as aiSdk from 'ai';

vi.mock('ai', () => {
  return {
    generateObject: vi.fn(),
  };
});

vi.mock('@ai-sdk/openai', () => ({
  openai: (modelId: string) => ({ id: `openai:${modelId}` }),
}));

describe('VercelAiSdkSkillJudger', () => {
  const generateObject = vi.mocked(aiSdk.generateObject);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls generateObject with shared prompts and maps the structured output', async () => {
    generateObject.mockResolvedValue({
      object: {
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
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

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

    expect(generateObject).toHaveBeenCalledTimes(1);
    const calledWith = generateObject.mock.calls[0]?.[0];
    expect(calledWith).toMatchObject({
      model: expect.any(Object),
      system: expect.stringContaining('risk judger'),
      prompt: expect.stringContaining('Target type: proposal'),
      maxRetries: 0,
    });
    expect((calledWith as { abortSignal?: AbortSignal }).abortSignal).toBeDefined();
    expect((calledWith as { schema?: object }).schema).toBeDefined();
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
    generateObject.mockRejectedValue(timeoutError);

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

  it('passes configured timeout and maxRetries to generateObject', async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);

    generateObject.mockResolvedValue({
      object: {
        summary: 'Looks okay overall.',
        skillPurposeSummary: null,
        dimensions: {
          harmful: { risk: 'low', score: 0, reason: 'No harmful content.' },
          promptInjection: { risk: 'medium', score: 0.4, reason: 'Hidden instruction found.' },
          dataExfiltration: { risk: 'low', score: 0, reason: 'No data leakage.' },
          policyViolation: { risk: 'low', score: 0, reason: 'No policy violation.' },
          qualityFit: { risk: 'low', score: 0, reason: 'Content fits the target purpose.' },
        },
      },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

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

    const calledWith = generateObject.mock.calls[0]?.[0];
    expect(timeoutSpy).toHaveBeenCalledWith(12000);
    expect(calledWith).toMatchObject({
      maxRetries: 2,
    });
  });

  it('maps structured output issues to JudgerProtocolError', async () => {
    generateObject.mockRejectedValue(new Error('Schema validation failed'));

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
    generateObject.mockRejectedValue(new Error('Service unavailable'));

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

  it('calls classifyAutoPublishCategory through generateObject', async () => {
    generateObject.mockResolvedValue({
      object: {
        blocked: false,
        matchedCategory: null,
        reason: 'No excluded category match.',
      },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const judger = new VercelAiSdkSkillJudger({
      model: 'openai:gpt-4.1',
      timeoutMs: 30000,
      maxTextChars: 12000,
      maxRetries: 0,
    });

    const result = await judger.classifyAutoPublishCategory({
      proposalId: 'proposal-1',
      title: 'Test',
      description: 'Test proposal',
      category: 'api-integration',
      tags: ['test'],
      capabilities: [],
      entrypoint: 'SKILL.md',
      excludedCategories: ['security'],
      content: 'Safe test content.',
    });

    expect(generateObject).toHaveBeenCalledTimes(1);
    const calledWith = generateObject.mock.calls[0]?.[0];
    expect((calledWith as { schema?: object }).schema).toBeDefined();
    expect(result.blocked).toBe(false);
    expect(result.matchedCategory).toBeNull();
    expect(result.reason).toContain('No excluded category');
    expect(result.model).toBe('vercel-ai-sdk:openai:gpt-4.1');
  });

  it('maps auto-publish classifier structured output issues to JudgerProtocolError', async () => {
    generateObject.mockRejectedValue(new Error('Schema validation failed'));

    const judger = new VercelAiSdkSkillJudger({
      model: 'openai:gpt-4.1',
      timeoutMs: 30000,
      maxTextChars: 12000,
      maxRetries: 0,
    });

    await expect(
      judger.classifyAutoPublishCategory({
        proposalId: 'proposal-1',
        title: 'Test',
        description: 'Test proposal',
        category: 'api-integration',
        tags: ['test'],
        capabilities: [],
        entrypoint: 'SKILL.md',
        excludedCategories: ['security'],
        content: 'Safe test content.',
      })
    ).rejects.toBeInstanceOf(JudgerProtocolError);
  });
});
