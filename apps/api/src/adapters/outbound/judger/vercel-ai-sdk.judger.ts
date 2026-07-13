import { Output, generateText, type LanguageModel } from 'ai';
import {
  AutoPublishCategoryCheckInput,
  AutoPublishCategoryCheckResult,
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

interface GenerateTextResult {
  output?: unknown;
  text?: string;
}

type GenerateStructuredText = (options: {
  model: LanguageModel;
  system: string;
  prompt: string;
  output: unknown;
  maxRetries: number;
  abortSignal: AbortSignal;
}) => Promise<GenerateTextResult>;

const generateStructuredText = generateText as unknown as GenerateStructuredText;
const createObjectOutput = Output.object as unknown as (options: { schema: unknown }) => unknown;

export class VercelAiSdkSkillJudger implements SkillJudgerPort {
  private readonly model: LanguageModel;

  constructor(private readonly config: VercelAiSdkSkillJudgerConfig) {
    try {
      this.model = resolveVercelAiModel(this.config.model);
    } catch (error) {
      throw new ValidationError(`Invalid Vercel AI SDK judger model configuration: ${(error as Error).message}`);
    }
  }

  async judge(target: JudgementTarget): Promise<Judgement> {
    let output: string | Record<string, unknown>;
    try {
      const result = await generateStructuredText({
        model: this.model,
        system: buildJudgementSystemPrompt(),
        prompt: buildJudgementUserPrompt(target, this.config.maxTextChars),
        output: createObjectOutput({ schema: judgementResponseZodSchema }),
        maxRetries: this.config.maxRetries,
        abortSignal: AbortSignal.timeout(this.config.timeoutMs),
      });

      output = normalizeOutput(result.output ?? result.text);
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
    let output: string | Record<string, unknown>;
    try {
      const result = await generateStructuredText({
        model: this.model,
        system: buildAutoPublishCategorySystemPrompt(),
        prompt: buildAutoPublishCategoryUserPrompt(input, this.config.maxTextChars),
        output: createObjectOutput({ schema: autoPublishCategoryResponseZodSchema }),
        maxRetries: this.config.maxRetries,
        abortSignal: AbortSignal.timeout(this.config.timeoutMs),
      });

      output = normalizeOutput(result.output ?? result.text);
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
}

function normalizeOutput(output: unknown): string | Record<string, unknown> {
  if (typeof output === 'string') {
    return output;
  }

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }

  return '';
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
    lowerMessage.includes('schema') ||
    lowerMessage.includes('output') ||
    code === 'INVALID_OUTPUT' ||
    statusCode === 422
  );
}
