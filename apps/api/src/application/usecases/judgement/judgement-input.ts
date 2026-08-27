import { createHash } from 'node:crypto';
import { Judgement } from '../../../domain/judgement/Judgement';
import { JudgementTarget } from '../../ports/outbound/judger.port';

/** Bump this whenever the canonical judgement prompt contract changes. */
export const JUDGEMENT_PROMPT_VERSION = '2026-08-judgement-input-v3';
export const MAX_JUDGEMENT_FILE_TEXT_CHARS = 8000;

export function truncateJudgementText(text: string): string {
  if (text.length <= MAX_JUDGEMENT_FILE_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_JUDGEMENT_FILE_TEXT_CHARS)}\n\n[TRUNCATED ${text.length - MAX_JUDGEMENT_FILE_TEXT_CHARS} CHARS]`;
}

export function resolveEffectiveEntrypoint(entrypoint: string | null, files: Array<{ path: string }>): string {
  return entrypoint ?? files[0]?.path ?? 'README.md';
}

export interface GlobalJudgementInput {
  targetType: 'proposal' | 'skill';
  targetId: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  useWhen?: string[];
  doNotUseWhen?: string[];
  entrypoint: string | null;
  files: Array<{ path: string; role?: string | null; mimeType: string | null; sizeBytes: number | null; sha256: string | null }>;
}

export function buildGlobalJudgementTarget(input: GlobalJudgementInput): JudgementTarget {
  const files = [...input.files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => ({ path: file.path, role: file.role ?? null, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256: file.sha256 }));
  return {
    type: input.targetType,
    id: input.targetId,
    title: input.title,
    text: stableStringify({
      title: input.title,
      description: input.description,
      category: input.category,
      tags: [...input.tags].sort(),
      capabilities: [...input.capabilities].sort(),
      useWhen: [...(input.useWhen ?? [])].sort(),
      doNotUseWhen: [...(input.doNotUseWhen ?? [])].sort(),
      entrypoint: input.entrypoint,
      files,
    }),
    metadata: { scope: 'global-skill-assessment' },
  };
}

export function buildFileJudgementTarget(input: {
  targetId: string; path: string; text: string; mimeType: string; sizeBytes: number; sha256: string | null; extractedBy: string;
}): JudgementTarget {
  return { type: 'file', id: input.targetId, title: input.path, text: input.text, metadata: {
    scope: 'file-assessment', mimeType: input.mimeType, sizeBytes: input.sizeBytes, sha256: input.sha256, extractedBy: input.extractedBy,
  } };
}

export function withJudgementInputFingerprint(judgement: Judgement, target: JudgementTarget, reuseScope = 'default'): Judgement {
  return Judgement.create({
    id: judgement.id, targetType: judgement.targetType, targetId: judgement.targetId,
    dimensions: judgement.dimensions, overallRisk: judgement.overallRisk, summary: judgement.summary,
    skillPurposeSummary: judgement.skillPurposeSummary, model: judgement.model,
    inputFingerprint: computeJudgementInputFingerprint(target, judgement.model, reuseScope),
    promptVersion: promptVersionFor(reuseScope), createdAt: judgement.createdAt,
  });
}

export function findReusableJudgement(target: JudgementTarget, judgements: Judgement[], reuseScope = 'default'): Judgement | null {
  return judgements.find((judgement) => judgement.model !== null && judgement.model !== 'noop'
    && judgement.promptVersion === promptVersionFor(reuseScope)
    && judgement.inputFingerprint === computeJudgementInputFingerprint(target, judgement.model, reuseScope)) ?? null;
}

export function cloneJudgementForTarget(source: Judgement, targetType: Judgement['targetType'], targetId: string): Judgement {
  return Judgement.create({ targetType, targetId, dimensions: source.dimensions, overallRisk: source.overallRisk,
    summary: source.summary, skillPurposeSummary: source.skillPurposeSummary, model: source.model,
    inputFingerprint: source.inputFingerprint, promptVersion: source.promptVersion });
}

export function stableStringify(value: unknown): string { return JSON.stringify(sortValue(value)); }

function promptVersionFor(reuseScope: string): string { return `${JUDGEMENT_PROMPT_VERSION}:${reuseScope}`; }

function computeJudgementInputFingerprint(target: JudgementTarget, model: string | null, reuseScope: string): string {
  return createHash('sha256').update(stableStringify({ promptVersion: JUDGEMENT_PROMPT_VERSION, reuseScope, model,
    title: target.title, text: target.text, metadata: target.metadata ?? {} })).digest('hex');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, sortValue(nested)]));
  return value;
}
