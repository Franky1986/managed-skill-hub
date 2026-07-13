import type { LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';

const MODEL_ID_PATTERN = /^([a-z0-9-]+):(.+)$/i;

export interface ResolvedVercelAiModel {
  provider: string;
  modelId: string;
}

export function parseVercelAiModelId(modelId: string): ResolvedVercelAiModel {
  const match = modelId.match(MODEL_ID_PATTERN);
  if (!match) {
    throw new Error(`Invalid Vercel AI model ID "${modelId}". Expected format: provider:modelId`);
  }

  return {
    provider: match[1].toLowerCase(),
    modelId: match[2],
  };
}

export function resolveVercelAiModel(modelId: string): LanguageModel {
  const { provider, modelId: resolvedModelId } = parseVercelAiModelId(modelId);

  switch (provider) {
    case 'openai':
      return openai(resolvedModelId);
    default:
      throw new Error(`Unsupported Vercel AI provider "${provider}" in model id "${modelId}"`);
  }
}

export function supportedVercelAiProviders(): string[] {
  return ['openai'];
}
