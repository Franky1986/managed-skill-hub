export type OperationKind =
  | 'finalize_proposal_upload'
  | 'rejudge_proposal'
  | 'rejudge_proposal_file'
  | 'rejudge_skill_version'
  | 'publish_skill_version'
  | 'convert_proposal_and_publish';

export type OperationState = 'queued' | 'running' | 'completed' | 'failed';

export interface OperationProgress {
  phase: string;
  message: string;
  completed: number;
  total: number;
  currentTarget: string | null;
}

export interface OperationRecord extends OperationProgress {
  id: string;
  kind: OperationKind;
  state: OperationState;
  proposalId: string | null;
  skillId: string | null;
  skillVersion: string | null;
  filePath: string | null;
  requestedBy: string;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  errorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
}

export interface CreateOperationInput {
  id: string;
  kind: OperationKind;
  proposalId?: string | null;
  skillId?: string | null;
  skillVersion?: string | null;
  filePath?: string | null;
  requestedBy: string;
  payload?: Record<string, unknown>;
  /** Present only while this logical operation is queued or running. */
  dedupeKey: string;
  progress: OperationProgress;
}

export interface OperationStorePort {
  createOperation(input: CreateOperationInput): Promise<OperationRecord>;
  getOperation(id: string): Promise<OperationRecord | null>;
  findActiveOperation(dedupeKey: string): Promise<OperationRecord | null>;
  listRunnableOperations(limit: number): Promise<OperationRecord[]>;
  claimOperation(id: string, workerId: string, leaseUntil: Date): Promise<OperationRecord | null>;
  updateOperation(id: string, workerId: string, patch: Partial<OperationProgress> & {
    state?: Extract<OperationState, 'completed' | 'failed'>;
    errorCode?: string | null;
  }): Promise<OperationRecord | null>;
}
