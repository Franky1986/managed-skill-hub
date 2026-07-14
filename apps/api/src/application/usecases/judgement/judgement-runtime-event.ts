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

export function judgementErrorCategory(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'UnknownError';
}
