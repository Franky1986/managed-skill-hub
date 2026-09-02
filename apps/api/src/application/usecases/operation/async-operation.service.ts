import { createHash, randomUUID } from 'node:crypto';
import { OperationCommandPort, StartOperationInput } from '../../ports/inbound/operation-command.port';
import { ProposalActor, ProposalCommandPort } from '../../ports/inbound/proposal-command.port';
import { OperationProgress, OperationRecord, OperationStorePort } from '../../ports/outbound/operation-store.port';
import { JudgeProposalUseCase } from '../judgement/judge-proposal.usecase';
import { JudgeSkillVersionUseCase } from '../judgement/judge-skill-version.usecase';
import { ReviewSkillUseCase } from '../skill/review-skill.usecase';
import { JudgementOverrideReasonRequiredError, JudgementRequiredError } from '../../../domain/errors';

const LEASE_MS = 5 * 60_000;
const HEARTBEAT_MS = Math.floor(LEASE_MS / 3);
const POLL_MS = 2_000;
const MAX_CONCURRENT_OPERATIONS = 2;

class OperationLeaseLostError extends Error {
  constructor() {
    super('Operation lease was lost.');
  }
}

/**
 * Executes review work outside the HTTP request while retaining a durable,
 * queryable operation record. A lease prevents two API processes from running
 * the same work; expired leases are picked up after a process crash.
 */
export class AsyncOperationService implements OperationCommandPort {
  private readonly workerId = randomUUID();
  private readonly scheduled = new Set<string>();
  private readonly pending: string[] = [];
  private running = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastWorkerWarningAt = 0;

  constructor(
    private readonly store: OperationStorePort,
    private readonly proposalCommand: ProposalCommandPort,
    private readonly judgeProposal: JudgeProposalUseCase,
    private readonly judgeSkillVersion: JudgeSkillVersionUseCase,
    private readonly reviewSkill: ReviewSkillUseCase
  ) {}

  /** Starts a bounded durable worker loop; timers are unref'd for CLI/test shutdown. */
  startWorker(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.resume().catch(() => this.reportWorkerFailure('poll')), POLL_MS);
    this.pollTimer.unref();
  }

  /** Stops background polling before storage clients are closed during shutdown. */
  stopWorker(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async start(input: StartOperationInput): Promise<OperationRecord> {
    const dedupeKey = operationDedupeKey(input);
    const existing = await this.store.findActiveOperation(dedupeKey);
    if (existing) return existing;
    const create = {
      id: randomUUID(),
      kind: input.kind,
      proposalId: input.proposalId ?? null,
      skillId: input.skillId ?? null,
      skillVersion: input.skillVersion ?? null,
      filePath: input.filePath ?? null,
      requestedBy: input.requestedBy,
      payload: input.payload ?? {},
      progress: initialProgress(input.kind),
      dedupeKey,
    };
    let record: OperationRecord;
    try {
      record = await this.store.createOperation(create);
    } catch (error) {
      // The database unique key closes the race between the lookup and insert.
      const winner = await this.store.findActiveOperation(dedupeKey);
      if (!winner) throw error;
      record = winner;
    }
    this.schedule(record.id);
    return record;
  }

  async get(id: string): Promise<OperationRecord | null> {
    return this.store.getOperation(id);
  }

  async resume(): Promise<void> {
    const records = await this.store.listRunnableOperations(100);
    for (const record of records) this.schedule(record.id);
  }

  private schedule(id: string): void {
    if (this.scheduled.has(id)) return;
    this.scheduled.add(id);
    this.pending.push(id);
    this.drain();
  }

  private drain(): void {
    while (this.running < MAX_CONCURRENT_OPERATIONS && this.pending.length > 0) {
      const id = this.pending.shift();
      if (!id) continue;
      this.running += 1;
      queueMicrotask(() => void this.run(id));
    }
  }

  private async run(id: string): Promise<void> {
    try {
      const operation = await this.store.claimOperation(id, this.workerId, new Date(Date.now() + LEASE_MS));
      if (!operation) return;
      let leaseLost = false;
      let heartbeatInFlight = false;
      const assertLease = (): void => {
        if (leaseLost) throw new OperationLeaseLostError();
      };
      const renewLease = async (): Promise<void> => {
        if (leaseLost || heartbeatInFlight) return;
        heartbeatInFlight = true;
        try {
          const renewed = await this.store.updateOperation(id, this.workerId, {});
          if (!renewed) leaseLost = true;
        } catch {
          this.reportWorkerFailure('heartbeat');
        } finally {
          heartbeatInFlight = false;
        }
      };
      const heartbeat = setInterval(() => void renewLease(), HEARTBEAT_MS);
      heartbeat.unref();
      const report = async (progress: OperationProgress): Promise<void> => {
        assertLease();
        const updated = await this.store.updateOperation(id, this.workerId, progress);
        if (!updated) {
          leaseLost = true;
          throw new OperationLeaseLostError();
        }
      };
      try {
        await this.execute(operation, report);
        assertLease();
        const latest = await this.store.getOperation(id);
        const completed = await this.store.updateOperation(id, this.workerId, {
          state: 'completed', phase: 'completed', message: 'Operation completed.',
          completed: latest?.total || 1, total: latest?.total || 1, currentTarget: null,
        });
        if (!completed) throw new OperationLeaseLostError();
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      if (error instanceof OperationLeaseLostError) return;
      await this.store.updateOperation(id, this.workerId, {
        state: 'failed', phase: 'failed', message: operationErrorMessage(error),
        errorCode: operationErrorCode(error), currentTarget: null,
      }).catch(() => undefined);
    } finally {
      this.scheduled.delete(id);
      this.running -= 1;
      this.drain();
    }
  }

  private async execute(operation: OperationRecord, report: (progress: OperationProgress) => Promise<void>): Promise<void> {
    switch (operation.kind) {
      case 'finalize_proposal_upload': {
        const actor = readProposalActor(operation.payload, operation.requestedBy);
        await this.proposalCommand.finalizeUpload(required(operation.proposalId, 'proposalId'), actor, {
          report: async (progress) => report({ ...progress, currentTarget: progress.currentTarget ?? null }),
        });
        return;
      }
      case 'rejudge_proposal':
        await report({ phase: 'judging_proposal', message: 'Judging proposal metadata.', completed: 0, total: 1, currentTarget: null });
        await this.judgeProposal.execute(required(operation.proposalId, 'proposalId'));
        return;
      case 'rejudge_proposal_file':
        await report({ phase: 'judging_files', message: `Judging ${required(operation.filePath, 'filePath')}.`, completed: 0, total: 1, currentTarget: operation.filePath });
        await this.judgeProposal.executeFile(required(operation.proposalId, 'proposalId'), required(operation.filePath, 'filePath'));
        return;
      case 'rejudge_skill_version':
        await this.judgeSkillVersion.execute(required(operation.skillId, 'skillId'), required(operation.skillVersion, 'skillVersion'), {
          actor: operation.requestedBy,
          progress: report,
        });
        return;
      case 'publish_skill_version': {
        await report({ phase: 'publishing', message: 'Verifying publication requirements and publishing the version.', completed: 0, total: 1, currentTarget: null });
        await this.reviewSkill.publish(required(operation.skillId, 'skillId'), required(operation.skillVersion, 'skillVersion'), operation.requestedBy, {
          judgementOverrideAllowed: operation.payload.judgementOverrideAllowed === true,
          judgementOverrideReason: readOptionalString(operation.payload, 'judgementOverrideReason'),
        });
        return;
      }
    }
  }

  private reportWorkerFailure(source: 'heartbeat' | 'poll'): void {
    const now = Date.now();
    if (now - this.lastWorkerWarningAt < POLL_MS) return;
    this.lastWorkerWarningAt = now;
    process.emitWarning(`Async operation worker ${source} failed; it will retry.`, {
      code: 'ASYNC_OPERATION_WORKER_RETRY',
    });
  }
}

function operationDedupeKey(input: StartOperationInput): string {
  const logicalKey = [input.kind, input.proposalId ?? '', input.skillId ?? '', input.skillVersion ?? '', input.filePath ?? ''].join(':');
  // Keep storage-provider behavior identical and satisfy MySQL's safe indexed
  // key size without truncating logical operation identity.
  return createHash('sha256').update(logicalKey).digest('hex');
}

function operationErrorCode(error: unknown): string {
  if (error instanceof JudgementOverrideReasonRequiredError) return 'JUDGEMENT_OVERRIDE_REQUIRED';
  if (error instanceof JudgementRequiredError) return 'JUDGEMENT_REQUIRED';
  return 'OPERATION_FAILED';
}

function operationErrorMessage(error: unknown): string {
  if (error instanceof JudgementOverrideReasonRequiredError) return error.message;
  if (error instanceof JudgementRequiredError) return error.message;
  return 'Operation failed. Review the operation details and retry when the cause is resolved.';
}

function initialProgress(kind: StartOperationInput['kind']): OperationProgress {
  const message = kind === 'publish_skill_version' ? 'Publication queued.' : 'Judgement operation queued.';
  return { phase: 'queued', message, completed: 0, total: 0, currentTarget: null };
}

function required(value: string | null, field: string): string {
  if (!value) throw new Error(`Missing ${field} for operation.`);
  return value;
}

function readOptionalString(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readProposalActor(payload: Record<string, unknown>, fallback: string): ProposalActor {
  const actor = payload.actor;
  if (actor && typeof actor === 'object' && 'principalId' in actor && typeof actor.principalId === 'string' && 'label' in actor && typeof actor.label === 'string') {
    const verified = actor as { label: string; principalId: string; clientId?: unknown };
    return { label: verified.label, principalId: verified.principalId, clientId: typeof verified.clientId === 'string' ? verified.clientId : null };
  }
  return fallback;
}
