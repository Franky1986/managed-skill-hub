import { z } from 'zod';
import { AutoPublishCategoryCheckInput, AutoPublishCategoryCheckResult } from '../../../application/ports/outbound/judger.port';
import { JudgerProtocolError } from '../../../domain/errors';

export const autoPublishCategoryResponseZodSchema = z.object({
  blocked: z.boolean(),
  matchedCategory: z.string().nullable().optional(),
  reason: z.string(),
});

export function buildAutoPublishCategorySystemPrompt(): string {
  return [
    'You are a policy gate for automatic publication in the ManagedSkillHub skill registry.',
    'Decide whether this proposal should be blocked from auto-publish because it belongs to one of the excluded coarse categories.',
    'Use conservative judgement. If the content plausibly belongs to an excluded category, block it.',
    'Consider metadata and extracted file content together.',
    'Respond only with valid JSON and no extra text.',
    'Schema:',
    JSON.stringify({
      blocked: true,
      matchedCategory: 'string|null',
      reason: 'string',
    }),
  ].join('\n');
}

export function buildAutoPublishCategoryUserPrompt(input: AutoPublishCategoryCheckInput, maxTextChars: number): string {
  return [
    'Excluded categories:',
    input.excludedCategories.join(', '),
    '',
    'Proposal metadata:',
    JSON.stringify({
      proposalId: input.proposalId,
      title: input.title,
      description: input.description,
      category: input.category,
      tags: input.tags,
      capabilities: input.capabilities,
      entrypoint: input.entrypoint,
    }, null, 2),
    '',
    'Extracted proposal content:',
    truncateText(input.content, maxTextChars),
  ].join('\n');
}

export function parseAutoPublishCategoryOutput(
  output: string | Record<string, unknown>,
  sourceName: string,
  model: string | null
): AutoPublishCategoryCheckResult {
  const record = typeof output === 'string' ? parseJsonObject(output, sourceName) : output;
  const parsed = autoPublishCategoryResponseZodSchema.safeParse(record);
  if (!parsed.success) {
    throw new JudgerProtocolError(`${sourceName} auto-publish category response is invalid`);
  }
  const data = parsed.data as {
    blocked: boolean;
    matchedCategory?: string | null;
    reason: string;
  };

  return {
    blocked: data.blocked,
    matchedCategory: normalizeNullableString(data.matchedCategory),
    reason: data.reason.trim(),
    model,
  };
}

function truncateText(text: string, maxTextChars: number): string {
  if (text.length <= maxTextChars) {
    return text;
  }
  return `${text.slice(0, maxTextChars)}\n\n[TRUNCATED ${text.length - maxTextChars} CHARS]`;
}

function parseJsonObject(input: string, sourceName: string): Record<string, unknown> {
  const normalized = input.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = normalized.indexOf('{');
  const last = normalized.lastIndexOf('}');
  const jsonCandidate = first !== -1 && last !== -1 && last > first
    ? normalized.slice(first, last + 1)
    : normalized;

  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Parsed value is not an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new JudgerProtocolError(
      `${sourceName} auto-publish category response is not valid JSON: ${(error as Error).message}`
    );
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
