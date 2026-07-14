import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { JudgementOverallRisk } from '../../../domain/judgement/Judgement';

export type JudgementExecutionState = 'not_started' | 'completed' | 'unavailable' | 'failed';
export type FinalizeJudgementStatus = 'completed' | 'partial' | 'unavailable' | 'failed';

export interface JudgementExecutionStatus {
  state: JudgementExecutionState;
  provider: string;
  attemptedAt: Date | null;
  message: string;
}

interface JudgementLike {
  targetType: 'proposal' | 'skill' | 'file';
  targetId: string;
  overallRisk: JudgementOverallRisk;
  model: string | null;
  createdAt: Date;
}

export function deriveJudgementExecutionStatus(input: {
  targetType: JudgementLike['targetType'];
  targetId: string;
  judgements: JudgementLike[];
  auditEntries: AuditEntry[];
  provider: string;
  started: boolean;
  failureActions: string[];
  failureFilePath?: string;
}): JudgementExecutionStatus {
  const latestJudgement = input.judgements
    .filter((item) => item.targetType === input.targetType && item.targetId === input.targetId)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

  const latestFailure = input.auditEntries
    .filter((entry) => input.failureActions.includes(entry.action))
    .filter((entry) => !input.failureFilePath || readAuditString(entry.after, 'file') === input.failureFilePath)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

  if (latestFailure && (!latestJudgement || latestFailure.createdAt.getTime() > latestJudgement.createdAt.getTime())) {
    return {
      state: 'failed',
      provider: input.provider,
      attemptedAt: latestFailure.createdAt,
      message: 'The judgement attempt failed. The configured provider may be unavailable or misconfigured.',
    };
  }

  if (latestJudgement) {
    const unavailable = latestJudgement.overallRisk === 'no_judge_available'
      || latestJudgement.model === null
      || latestJudgement.model === 'noop';
    return {
      state: unavailable ? 'unavailable' : 'completed',
      provider: input.provider,
      attemptedAt: latestJudgement.createdAt,
      message: unavailable
        ? 'No real judgement provider produced a security assessment.'
        : 'Judgement completed successfully.',
    };
  }

  return {
    state: input.started ? 'unavailable' : 'not_started',
    provider: input.provider,
    attemptedAt: null,
    message: input.started
      ? 'No judgement result is available for this target.'
      : 'Judgement has not started yet.',
  };
}

export function deriveFinalizeJudgementStatus(proposal: {
  id: string;
  files: Array<{ path: string }>;
  judgements: Array<{
    targetId: string;
    overallRisk: string;
    model: string | null;
  }>;
}): FinalizeJudgementStatus {
  const targetIds = [proposal.id, ...proposal.files.map((file) => `${proposal.id}:${file.path}`)];
  const latestByTarget = new Map<string, typeof proposal.judgements[number]>();
  for (const judgement of proposal.judgements) {
    if (targetIds.includes(judgement.targetId)) {
      latestByTarget.set(judgement.targetId, judgement);
    }
  }

  if (latestByTarget.size === 0) {
    return 'failed';
  }
  const realCount = [...latestByTarget.values()].filter((judgement) =>
    judgement.overallRisk !== 'no_judge_available'
      && judgement.model !== null
      && judgement.model !== 'noop'
  ).length;
  if (realCount === targetIds.length) {
    return 'completed';
  }
  if (realCount === 0 && latestByTarget.size === targetIds.length) {
    return 'unavailable';
  }
  return 'partial';
}

function readAuditString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' ? value : null;
}
