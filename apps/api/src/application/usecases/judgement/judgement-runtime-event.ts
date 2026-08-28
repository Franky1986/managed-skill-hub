export interface JudgementRuntimeEvent {
  event: 'judgement_execution';
  outcome: 'success' | 'failure';
  operation: 'proposal' | 'proposal_file' | 'skill_version' | 'skill_file';
  proposalId?: string;
  skillId?: string;
  version?: string;
  filePath?: string;
  errorCategory?: string;
}

export type JudgementRuntimeEventSink = (event: JudgementRuntimeEvent) => void;

const SAFE_ERROR_CATEGORIES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ValidationError',
  'NotFoundError',
  'ForbiddenError',
  'ConflictError',
  'StorageError',
]);

export function judgementErrorCategory(error: unknown): string {
  return error instanceof Error && SAFE_ERROR_CATEGORIES.has(error.name)
    ? error.name
    : 'UnexpectedError';
}
