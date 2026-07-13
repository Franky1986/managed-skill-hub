import { describe, expect, it } from 'vitest';
import { deriveProposalReviewMetadata } from './review-metadata';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';

describe('deriveProposalReviewMetadata', () => {
  it('marks safe proposals with low risk text-only content as safe', () => {
    const metadata = deriveProposalReviewMetadata({
      title: 'Readme only proposal',
      description: 'Contains plain markdown guidance',
      judgements: [createJudgement(JudgementRisk.LOW)],
      files: [{ path: 'README.md', mimeType: 'text/markdown' }],
    });

    expect(metadata.latestJudgementRisk).toBe('low');
    expect(metadata.labels).toContain('safe');
    expect(metadata.labels).not.toContain('needs_review');
  });

  it('marks executable and prompt-injection risky proposals for review', () => {
    const metadata = deriveProposalReviewMetadata({
      title: 'Setup script',
      description: 'Downloads a package and uses an API token',
      entrypoint: 'install.sh',
      judgements: [
        createJudgement(JudgementRisk.HIGH, {
          promptInjection: { risk: JudgementRisk.HIGH, score: 0.9, reason: 'hidden instructions detected' },
        }),
      ],
      files: [{ path: 'install.sh', mimeType: 'application/x-sh' }],
    });

    expect(metadata.labels).toEqual(
      expect.arrayContaining([
        'needs_review',
        'contains_executable',
        'external_dependency',
        'sensitive_input',
        'prompt_injection_risk',
      ])
    );
  });

  it('marks binary-only proposals as download_only', () => {
    const metadata = deriveProposalReviewMetadata({
      title: 'Binary archive',
      description: 'Contains screenshots',
      judgements: [createJudgement(JudgementRisk.LOW)],
      files: [{ path: 'preview.png', mimeType: 'image/png' }],
    });

    expect(metadata.labels).toContain('download_only');
  });

  it('uses the highest judgement risk instead of the last judgement risk for proposal summary', () => {
    const metadata = deriveProposalReviewMetadata({
      title: 'Mixed proposal',
      description: 'A later low file judgement must not hide an earlier medium risk.',
      judgements: [
        createJudgement(JudgementRisk.MEDIUM),
        createJudgement(JudgementRisk.LOW),
      ],
      files: [{ path: 'template.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }],
    });

    expect(metadata.latestJudgementRisk).toBe('medium');
    expect(metadata.labels).toContain('needs_review');
  });
});

function createJudgement(
  overallRisk: JudgementRisk,
  overrides?: Partial<Record<'harmful' | 'promptInjection' | 'dataExfiltration' | 'policyViolation', { risk: JudgementRisk; score: number; reason: string }>>
) {
  const baseRisk =
    overallRisk === JudgementRisk.CRITICAL
      ? JudgementRisk.CRITICAL
      : overallRisk === JudgementRisk.HIGH
        ? JudgementRisk.HIGH
        : overallRisk === JudgementRisk.MEDIUM
          ? JudgementRisk.MEDIUM
          : JudgementRisk.LOW;

  return Judgement.create({
    targetType: 'proposal',
    targetId: 'proposal-1',
    summary: 'review summary',
    dimensions: {
      harmful: { risk: baseRisk, score: 0.5, reason: 'base' },
      promptInjection: { risk: JudgementRisk.LOW, score: 0, reason: 'none' },
      dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'none' },
      policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'none' },
      ...overrides,
    },
  });
}
