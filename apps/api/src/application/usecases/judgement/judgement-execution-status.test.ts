import { describe, expect, it } from 'vitest';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { Judgement, JudgementRisk } from '../../../domain/judgement/Judgement';
import { deriveFinalizeJudgementStatus, deriveJudgementExecutionStatus } from './judgement-execution-status';

describe('deriveJudgementExecutionStatus', () => {
  it('reports a failure that happened after an older successful judgement', () => {
    const judgement = Judgement.create({
      id: 'judgement-1',
      targetType: 'proposal',
      targetId: 'proposal-1',
      summary: 'Completed once',
      model: 'real-model',
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      dimensions: {
        safety: { risk: JudgementRisk.LOW, score: 0.1, reason: 'Clear' },
      },
    });
    const failure = AuditEntry.create({
      action: 'proposal_judgement_failed',
      actor: 'system',
      proposalId: 'proposal-1',
      createdAt: new Date('2026-07-01T11:00:00.000Z'),
    });

    const status = deriveJudgementExecutionStatus({
      targetType: 'proposal',
      targetId: 'proposal-1',
      judgements: [judgement],
      auditEntries: [failure],
      provider: 'custom',
      started: true,
      failureActions: ['proposal_judgement_failed'],
    });

    expect(status.state).toBe('failed');
    expect(status.attemptedAt).toEqual(new Date('2026-07-01T11:00:00.000Z'));
  });

  it('reports noop placeholder judgements as unavailable', () => {
    const judgement = Judgement.create({
      targetType: 'file',
      targetId: 'proposal-1:SKILL.md',
      summary: 'No judge configured',
      model: 'noop',
      overallRisk: JudgementRisk.NO_JUDGE_AVAILABLE,
      dimensions: {
        availability: {
          risk: JudgementRisk.NO_JUDGE_AVAILABLE,
          score: 0,
          reason: 'No provider configured',
        },
      },
    });

    const status = deriveJudgementExecutionStatus({
      targetType: 'file',
      targetId: 'proposal-1:SKILL.md',
      judgements: [judgement],
      auditEntries: [],
      provider: 'noop',
      started: true,
      failureActions: ['file_judgement_failed'],
      failureFilePath: 'SKILL.md',
    });

    expect(status.state).toBe('unavailable');
  });

  it('does not report finalization complete when targets are missing or noop', () => {
    const proposal = {
      id: 'proposal-1',
      files: [{ path: 'SKILL.md' }],
    };

    expect(deriveFinalizeJudgementStatus({ ...proposal, judgements: [] })).toBe('failed');
    expect(deriveFinalizeJudgementStatus({
      ...proposal,
      judgements: [
        { targetId: 'proposal-1', overallRisk: 'low', model: 'real-model' },
      ],
    })).toBe('partial');
    expect(deriveFinalizeJudgementStatus({
      ...proposal,
      judgements: [
        { targetId: 'proposal-1', overallRisk: 'no_judge_available', model: 'noop' },
        { targetId: 'proposal-1:SKILL.md', overallRisk: 'no_judge_available', model: 'noop' },
      ],
    })).toBe('unavailable');
    expect(deriveFinalizeJudgementStatus({
      ...proposal,
      judgements: [
        { targetId: 'proposal-1', overallRisk: 'low', model: 'real-model' },
        { targetId: 'proposal-1:SKILL.md', overallRisk: 'medium', model: 'real-model' },
      ],
    })).toBe('completed');
  });
});
