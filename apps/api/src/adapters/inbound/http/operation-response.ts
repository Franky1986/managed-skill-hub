import { OperationRecord } from '../../../application/ports/outbound/operation-store.port';

/** Public/admin progress projection. Worker payload and requester data remain private. */
export function operationResponse(operation: OperationRecord) {
  return {
    id: operation.id,
    kind: operation.kind,
    state: operation.state,
    proposalId: operation.proposalId,
    skillId: operation.skillId,
    skillVersion: operation.skillVersion,
    filePath: operation.filePath,
    phase: operation.phase,
    message: operation.message,
    completed: operation.completed,
    total: operation.total,
    currentTarget: operation.currentTarget,
    errorCode: operation.errorCode,
    createdAt: operation.createdAt,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    updatedAt: operation.updatedAt,
  };
}
