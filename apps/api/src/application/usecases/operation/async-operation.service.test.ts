import { describe, expect, it, vi } from 'vitest';
import { AsyncOperationService } from './async-operation.service';
import { CreateOperationInput, OperationRecord, OperationStorePort } from '../../ports/outbound/operation-store.port';
import { JudgementOverrideReasonRequiredError } from '../../../domain/errors';

class MemoryOperationStore implements OperationStorePort {
  readonly records = new Map<string, OperationRecord>();

  async createOperation(input: CreateOperationInput): Promise<OperationRecord> {
    const now = new Date();
    const record: OperationRecord = { ...input, proposalId: input.proposalId ?? null, skillId: input.skillId ?? null,
      skillVersion: input.skillVersion ?? null, filePath: input.filePath ?? null, payload: input.payload ?? {}, dedupeKey: input.dedupeKey,
      state: 'queued', errorCode: null, createdAt: now, startedAt: null, finishedAt: null, updatedAt: now };
    this.records.set(record.id, record);
    return record;
  }
  async getOperation(id: string): Promise<OperationRecord | null> { return this.records.get(id) ?? null; }
  async findActiveOperation(dedupeKey: string): Promise<OperationRecord | null> {
    return [...this.records.values()].find((item) => item.dedupeKey === dedupeKey && ['queued', 'running'].includes(item.state)) ?? null;
  }
  async listRunnableOperations(): Promise<OperationRecord[]> { return [...this.records.values()].filter((item) => item.state === 'queued'); }
  async claimOperation(id: string): Promise<OperationRecord | null> {
    const record = this.records.get(id);
    if (!record || record.state !== 'queued') return null;
    const next = { ...record, state: 'running' as const, startedAt: new Date(), updatedAt: new Date() };
    this.records.set(id, next);
    return next;
  }
  async updateOperation(id: string, _workerId: string, patch: Parameters<OperationStorePort['updateOperation']>[2]): Promise<OperationRecord | null> {
    const record = this.records.get(id);
    if (!record) return null;
    const next: OperationRecord = { ...record, ...patch, state: patch.state ?? record.state,
      currentTarget: patch.currentTarget === undefined ? record.currentTarget : patch.currentTarget,
      errorCode: patch.errorCode === undefined ? record.errorCode : patch.errorCode,
      finishedAt: patch.state === 'completed' || patch.state === 'failed' ? new Date() : record.finishedAt, updatedAt: new Date() };
    this.records.set(id, next);
    return next;
  }
}

async function settled(store: MemoryOperationStore, id: string): Promise<OperationRecord> {
  for (let index = 0; index < 20; index += 1) {
    const operation = await store.getOperation(id);
    if (operation?.state === 'completed' || operation?.state === 'failed') return operation;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('operation did not settle');
}

describe('AsyncOperationService', () => {
  it('persists incremental proposal-finalization progress and completes outside the caller', async () => {
    const store = new MemoryOperationStore();
    const finalizeUpload = vi.fn(async (_id, _actor, progress) => {
      await progress.report({ phase: 'extracting', message: 'Extracting README.md.', completed: 1, total: 2, currentTarget: 'README.md' });
      await progress.report({ phase: 'judging_files', message: 'Judging SKILL.md.', completed: 2, total: 2, currentTarget: 'SKILL.md' });
      return {};
    });
    const service = new AsyncOperationService(store, { finalizeUpload } as never, {} as never, {} as never, {} as never);

    const accepted = await service.start({ kind: 'finalize_proposal_upload', proposalId: 'proposal-1', requestedBy: 'agent' });
    expect(accepted.state).toBe('queued');
    const completed = await settled(store, accepted.id);

    expect(finalizeUpload).toHaveBeenCalledWith('proposal-1', 'agent', expect.any(Object));
    expect(completed).toMatchObject({ state: 'completed', phase: 'completed', completed: 2, total: 2, currentTarget: null });
  });

  it('persists the safe override-reason failure for asynchronous publication', async () => {
    const store = new MemoryOperationStore();
    const reviewSkill = { publish: vi.fn().mockRejectedValue(new JudgementOverrideReasonRequiredError()) };
    const service = new AsyncOperationService(store, {} as never, {} as never, {} as never, reviewSkill as never);

    const accepted = await service.start({ kind: 'publish_skill_version', skillId: 'skill-1', skillVersion: '1.0.0', requestedBy: 'admin' });
    const failed = await settled(store, accepted.id);

    expect(failed).toMatchObject({ state: 'failed', errorCode: 'JUDGEMENT_OVERRIDE_REQUIRED', message: 'A judgement override reason is required.' });
  });

  it('runs convert, review, approval, and publication as one durable workflow', async () => {
    const store = new MemoryOperationStore();
    let converted = false;
    let versionStatus = 'draft';
    const proposalRead = {
      getDetail: vi.fn(async () => ({
        id: 'proposal-1',
        status: converted ? 'converted' : 'judged',
        convertedVersion: converted ? '1.0.0' : null,
        conversion: { targetSkillId: 'skill-1' },
      })),
    };
    const reviewProposal = { convertProposal: vi.fn(async () => { converted = true; }) };
    const reviewSkill = {
      submitForReview: vi.fn(async () => { versionStatus = 'in_review'; }),
      approve: vi.fn(async () => { versionStatus = 'approved'; }),
      publish: vi.fn(async () => { versionStatus = 'published'; }),
    };
    const adminSkillRead = {
      getSkillDetail: vi.fn(async () => ({ versions: [{ version: '1.0.0', status: versionStatus }] })),
    };
    const service = new AsyncOperationService(
      store,
      {} as never,
      {} as never,
      {} as never,
      reviewSkill as never,
      reviewProposal as never,
      proposalRead as never,
      adminSkillRead as never
    );

    const accepted = await service.start({ kind: 'convert_proposal_and_publish', proposalId: 'proposal-1', requestedBy: 'admin' });
    const completed = await settled(store, accepted.id);

    expect(reviewProposal.convertProposal).toHaveBeenCalledWith('proposal-1', 'admin', undefined);
    expect(reviewSkill.submitForReview).toHaveBeenCalledWith('skill-1', '1.0.0', 'admin');
    expect(reviewSkill.approve).toHaveBeenCalledWith('skill-1', '1.0.0', 'admin');
    expect(reviewSkill.publish).toHaveBeenCalledWith('skill-1', '1.0.0', 'admin', expect.objectContaining({ judgementOverrideAllowed: false }));
    expect(completed).toMatchObject({ state: 'completed', completed: 4, total: 4 });
  });

  it('resumes a converted workflow with an override reason without repeating prior transitions', async () => {
    const store = new MemoryOperationStore();
    let converted = false;
    let versionStatus = 'draft';
    const proposalRead = {
      getDetail: vi.fn(async () => ({
        id: 'prop-idem-1',
        status: converted ? 'converted' : 'judged',
        convertedVersion: converted ? '1.0.0' : null,
        conversion: { targetSkillId: 'skill-1' },
      })),
    };
    const reviewProposal = { convertProposal: vi.fn(async () => { converted = true; }) };
    const reviewSkill = {
      submitForReview: vi.fn(async () => { versionStatus = 'in_review'; }),
      approve: vi.fn(async () => { versionStatus = 'approved'; }),
      publish: vi.fn(async (_skillId, _version, _actor, options) => {
        if (!options.judgementOverrideReason) throw new JudgementOverrideReasonRequiredError();
        versionStatus = 'published';
      }),
    };
    const adminSkillRead = {
      getSkillDetail: vi.fn(async () => ({ versions: [{ version: '1.0.0', status: versionStatus }] })),
    };
    const service = new AsyncOperationService(store, {} as never, {} as never, {} as never, reviewSkill as never, reviewProposal as never, proposalRead as never, adminSkillRead as never);

    const initial = await service.start({ kind: 'convert_proposal_and_publish', proposalId: 'prop-idem-1', requestedBy: 'admin' });
    expect(await settled(store, initial.id)).toMatchObject({ state: 'failed', errorCode: 'JUDGEMENT_OVERRIDE_REQUIRED' });

    const retry = await service.start({
      kind: 'convert_proposal_and_publish', proposalId: 'prop-idem-1', requestedBy: 'admin',
      payload: { judgementOverrideAllowed: true, judgementOverrideReason: 'Manual review completed.' },
    });
    expect(await settled(store, retry.id)).toMatchObject({ state: 'completed' });
    expect(reviewProposal.convertProposal).toHaveBeenCalledTimes(1);
    expect(reviewSkill.submitForReview).toHaveBeenCalledTimes(1);
    expect(reviewSkill.approve).toHaveBeenCalledTimes(1);
    expect(reviewSkill.publish).toHaveBeenLastCalledWith('skill-1', '1.0.0', 'admin', expect.objectContaining({ judgementOverrideReason: 'Manual review completed.' }));
  });

  it('returns one active operation when a caller retries the same intent', async () => {
    const store = new MemoryOperationStore();
    const service = new AsyncOperationService(store, {} as never, {} as never, {} as never, {} as never);

    const first = await service.start({ kind: 'rejudge_proposal', proposalId: 'proposal-1', requestedBy: 'reviewer' });
    const second = await service.start({ kind: 'rejudge_proposal', proposalId: 'proposal-1', requestedBy: 'reviewer' });

    expect(second.id).toBe(first.id);
    expect(store.records).toHaveLength(1);
  });

  it('uses a fixed-size hash so distinct long file paths do not truncate into one MySQL operation', async () => {
    const store = new MemoryOperationStore();
    const service = new AsyncOperationService(store, {} as never, {} as never, {} as never, {} as never);
    const commonPrefix = `nested/${'a'.repeat(1_100)}`;

    const first = await service.start({ kind: 'rejudge_proposal_file', proposalId: 'proposal-1', filePath: `${commonPrefix}-one.md`, requestedBy: 'reviewer' });
    const second = await service.start({ kind: 'rejudge_proposal_file', proposalId: 'proposal-1', filePath: `${commonPrefix}-two.md`, requestedBy: 'reviewer' });

    expect(first.id).not.toBe(second.id);
    expect([...store.records.values()].every((record) => record.dedupeKey?.length === 64)).toBe(true);
  });

  it('stops before side effects when a progress update proves the worker lost its lease', async () => {
    const store = new MemoryOperationStore();
    const updateOperation = vi.spyOn(store, 'updateOperation').mockResolvedValueOnce(null);
    const judgeProposal = { execute: vi.fn() };
    const service = new AsyncOperationService(store, {} as never, judgeProposal as never, {} as never, {} as never);

    const accepted = await service.start({ kind: 'rejudge_proposal', proposalId: 'proposal-1', requestedBy: 'reviewer' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(updateOperation).toHaveBeenCalled();
    expect(judgeProposal.execute).not.toHaveBeenCalled();
    expect((await store.getOperation(accepted.id))?.state).toBe('running');
  });
});
