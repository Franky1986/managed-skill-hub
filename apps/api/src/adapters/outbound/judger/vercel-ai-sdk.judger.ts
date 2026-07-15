import { generateObject, type LanguageModel } from 'ai';
import {
  AutoPublishCategoryCheckInput,
  AutoPublishCategoryCheckResult,
  SemanticDuplicateInput,
  SemanticDuplicateResult,
  SkillJudgerPort,
  JudgementTarget,
} from '../../../application/ports/outbound/judger.port';
import { Judgement } from '../../../domain/judgement/Judgement';
import { JudgerProtocolError, JudgerTimeoutError, JudgerUnavailableError, ValidationError } from '../../../domain/errors';
import {
  autoPublishCategoryResponseZodSchema,
  buildAutoPublishCategorySystemPrompt,
  buildAutoPublishCategoryUserPrompt,
  parseAutoPublishCategoryOutput,
} from './auto-publish-category-contract';
import {
  buildDuplicateSimilaritySystemPrompt,
  buildDuplicateSimilarityUserPrompt,
  duplicateSimilarityResponseZodSchema,
  parseDuplicateSimilarityOutput,
} from './duplicate-similarity-contract';
import {
  buildJudgementSystemPrompt,
  buildJudgementUserPrompt,
  createJudgementFromOutput,
  judgementResponseZodSchema,
  parseJudgementOutput,
} from './judgement-contract';
import { resolveVercelAiModel } from './vercel-ai-sdk.registry';

interface VercelAiSdkSkillJudgerConfig {
  model: string;
  timeoutMs: number;
  maxTextChars: number;
  maxRetries: number;
}

// generateObject accepts FlexibleSchema; keep the call site typed loosely enough
// to avoid TypeScript type-instantiation depth errors with deeply nested Zod objects.
type GenerateObjectCaller = (options: {
  model: LanguageModel;
  system: string;
  prompt: string;
  schema: unknown;
  maxRetries: number;
  abortSignal: AbortSignal;
}) => Promise<{ object: unknown }>;

export class VercelAiSdkSkillJudger implements SkillJudgerPort {
  private readonly model: LanguageModel;
  private readonly generateObject: GenerateObjectCaller;

  constructor(private readonly config: VercelAiSdkSkillJudgerConfig) {
    try {
      this.model = resolveVercelAiModel(this.config.model);
    } catch (error) {
      throw new ValidationError(`Invalid Vercel AI SDK judger model configuration: ${(error as Error).message}`);
    }
    this.generateObject = generateObject as unknown as GenerateObjectCaller;
  }

  async judge(target: JudgementTarget): Promise<Judgement> {
    let output: Record<string, unknown>;
    try {
      const result = await this.generateObject({
        model: this.model,
        system: buildJudgementSystemPrompt(),
        prompt: buildJudgementUserPrompt(target, this.config.maxTextChars),
        schema: judgementResponseZodSchema,
        maxRetries: this.config.maxRetries,
        abortSignal: AbortSignal.timeout(this.config.timeoutMs),
      });

      output = result.object as Record<string, unknown>;
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new JudgerTimeoutError(`Vercel AI SDK judger timed out after ${this.config.timeoutMs} ms`);
      }
      if (isProtocolError(error)) {
        throw new JudgerProtocolError(`Vercel AI SDK output does not match the judgement schema: ${(error as Error).message}`);
      }
      throw new JudgerUnavailableError(
        `Vercel AI SDK judger request failed: ${(error as Error).message}`
      );
    }

    const parsed = parseJudgementOutput(output, `Vercel AI SDK (${this.config.model})`);
    return createJudgementFromOutput(target, parsed, `vercel-ai-sdk:${this.config.model}`);
  }

  async classifyAutoPublishCategory(input: AutoPublishCategoryCheckInput): Promise<AutoPublishCategoryCheckResult> {
    let output: Record<string, unknown>;
    try {
      const result = await this.generateObject({
        model: this.model,
        system: buildAutoPublishCategorySystemPrompt(),
        prompt: buildAutoPublishCategoryUserPrompt(input, this.config.maxTextChars),
        schema: autoPublishCategoryResponseZodSchema,
        maxRetries: this.config.maxRetries,
        abortSignal: AbortSignal.timeout(this.config.timeoutMs),
      });

      output = result.object as Record<string, unknown>;
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new JudgerTimeoutError(`Vercel AI SDK auto-publish classifier timed out after ${this.config.timeoutMs} ms`);
      }
      if (isProtocolError(error)) {
        throw new JudgerProtocolError(
          `Vercel AI SDK auto-publish classifier output does not match the schema: ${(error as Error).message}`
        );
      }
      throw new JudgerUnavailableError(
        `Vercel AI SDK auto-publish classifier request failed: ${(error as Error).message}`
      );
    }

    return parseAutoPublishCategoryOutput(output, `Vercel AI SDK (${this.config.model})`, `vercel-ai-sdk:${this.config.model}`);
  }

  async assessDuplicateSimilarity(input: SemanticDuplicateInput): Promise<SemanticDuplicateResult> {
    let output: Record<string, unknown>;
    try {
      const result = await this.generateObject({
        model: this.model,
        system: buildDuplicateSimilaritySystemPrompt(),
        prompt: buildDuplicateSimilarityUserPrompt(input, this.config.maxTextChars),
        schema: duplicateSimilarityResponseZodSchema,
        maxRetries: this.config.maxRetries,
        abortSignal: AbortSignal.timeout(this.config.timeoutMs),
      });

      output = result.object as Record<string, unknown>;
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new JudgerTimeoutError(`Vercel AI SDK duplicate similarity check timed out after ${this.config.timeoutMs} ms`);
      }
      if (isProtocolError(error)) {
        throw new JudgerProtocolError(
          `Vercel AI SDK duplicate similarity output does not match the schema: ${(error as Error).message}`
        );
      }
      throw new JudgerUnavailableError(
        `Vercel AI SDK duplicate similarity request failed: ${(error as Error).message}`
      );
    }

    return parseDuplicateSimilarityOutput(output, `Vercel AI SDK (${this.config.model})`, `vercel-ai-sdk:${this.config.model}`);
  }
}

function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function isProtocolError(error: unknown): boolean {
  const { name, message, code, statusCode } = error as {
    name?: string;
    message?: string;
    code?: string;
    statusCode?: number;
  };
  const lowerName = String(name ?? '').toLowerCase();
  const lowerMessage = String(message ?? '').toLowerCase();
  return (
    lowerName.includes('validation') ||
    lowerName.includes('schema') ||
    lowerName.includes('parse') ||
    lowerName.includes('output') ||
    lowerName.includes('object') ||
    lowerMessage.includes('schema') ||
    lowerMessage.includes('output') ||
    lowerMessage.includes('object') ||
    code === 'INVALID_OUTPUT' ||
    statusCode === 422
  );
}
