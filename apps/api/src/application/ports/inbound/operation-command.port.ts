import { OperationKind, OperationRecord } from '../outbound/operation-store.port';

export interface StartOperationInput {
  kind: OperationKind;
  proposalId?: string;
  skillId?: string;
  skillVersion?: string;
  filePath?: string;
  requestedBy: string;
  payload?: Record<string, unknown>;
}

export interface OperationCommandPort {
  start(input: StartOperationInput): Promise<OperationRecord>;
  get(id: string): Promise<OperationRecord | null>;
}
