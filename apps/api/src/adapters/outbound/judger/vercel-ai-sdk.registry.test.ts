import { describe, expect, it, vi } from 'vitest';
import { parseVercelAiModelId, resolveVercelAiModel, supportedVercelAiProviders } from './vercel-ai-sdk.registry';

vi.mock('@ai-sdk/openai', () => ({
  openai: (modelId: string) => ({ id: `openai:${modelId}` }),
}));

describe('vercel-ai-sdk.model registry', () => {
  it('parses provider:model identifiers', () => {
    expect(parseVercelAiModelId('openai:gpt-4.1')).toEqual({
      provider: 'openai',
      modelId: 'gpt-4.1',
    });
  });

  it('resolves a supported openai model', () => {
    const model = resolveVercelAiModel('openai:gpt-4.1');
    expect(model).toBeDefined();
  });

  it('rejects unsupported providers', () => {
    expect(() => resolveVercelAiModel('anthropic:claude-3')).toThrow(/Unsupported Vercel AI provider/);
  });

  it('exposes supported provider list', () => {
    expect(supportedVercelAiProviders()).toContain('openai');
  });
});
