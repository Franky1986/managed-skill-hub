import { describe, expect, it, vi } from 'vitest';
import { SubmitProposalUseCase } from './submit-proposal.usecase';
import { Proposal } from '../../../domain/proposal/Proposal';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillFileStoragePort, StoredExtractedContent, StoredFile } from '../../ports/outbound/file-storage.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillJudgerPort } from '../../ports/outbound/judger.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import {
  ForbiddenError,
  JudgerUnavailableError,
  ProposalDisallowedPathError,
  ProposalFileLimitExceededError,
  ProposalFileSizeLimitExceededError,
  ProposalUploadValidationError,
  ValidationError,
} from '../../../domain/errors';
import { CatalogProposalRecord, SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { Skill } from '../../../domain/skill/Skill';
import { JudgementRisk } from '../../../domain/judgement/Judgement';

describe('SubmitProposalUseCase', () => {
  it('uses stable OIDC principal ownership across agent sessions and rejects another human', async () => {
    const repo = new InMemorySkillRepository();
    const audit = new InMemoryAuditLog();
    const useCase = new SubmitProposalUseCase(
      repo,
      new InMemoryStorage(),
      audit,
      { judge: vi.fn() } as unknown as SkillJudgerPort,
      new StubScanner()
    );
    const owner = {
      label: 'Original Name',
      principalId: 'principal-owner',
      clientId: 'agent-session-1',
    };
    const proposal = await useCase.submitProposal({
      title: 'Stable owner',
      description: 'Ownership follows the internal principal.',
      category: 'security',
    }, owner);

    expect(proposal).toMatchObject({
      submittedBy: 'Original Name',
      submittedByPrincipalId: 'principal-owner',
      submittedViaClientId: 'agent-session-1',
    });
    await expect(useCase.updateProposalMetadata(proposal.id, { title: 'Updated' }, {
      label: 'Renamed Human',
      principalId: 'principal-owner',
      clientId: 'agent-session-2',
    })).resolves.toMatchObject({ title: 'Updated' });
    await expect(useCase.updateProposalMetadata(proposal.id, { title: 'Forbidden' }, {
      label: 'Original Name',
      principalId: 'principal-other',
      clientId: 'agent-session-3',
    })).rejects.toBeInstanceOf(ForbiddenError);
    expect(audit.entries[0]).toMatchObject({
      actorPrincipalId: 'principal-owner',
      actorDisplayName: 'Original Name',
      actorClientId: 'agent-session-1',
    });
  });

  it('creates proposals in in_upload without running judgements yet', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn().mockRejectedValue(new JudgerUnavailableError('custom judger unavailable')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();

    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);

    const proposal = await useCase.submitProposal(
      {
        title: 'Proposal survives judgement outage',
        description: 'Judger errors must not drop the proposal.',
        category: 'automation',
      },
      'agent'
    );

    const stored = await repo.findProposalById(proposal.id);

    expect(proposal.status).toBe('in_upload');
    expect(stored?.status).toBe('in_upload');
    expect(stored?.judgements).toHaveLength(0);
    expect(audit.entries.some((entry) => entry.action === 'proposal_judgement_failed')).toBe(false);
    expect(audit.entries.some((entry) => entry.action === 'submit_proposal')).toBe(true);
    expect(judger.judge).not.toHaveBeenCalled();
  });

  it('keeps the uploaded file attached and delays file judgement until finalization', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi
        .fn()
        .mockResolvedValueOnce(createJudgement('proposal-judgement', 'proposal', 'proposal-id'))
        .mockRejectedValueOnce(new JudgerUnavailableError('custom judger unavailable')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();

    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Proposal with file',
        description: 'Tests file attachment fallback.',
        category: 'automation',
      },
      'agent'
    );

    const updated = await useCase.attachFile(
      proposal.id,
      {
        path: 'README.md',
        content: Buffer.from('# test'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    const stored = await repo.findProposalById(proposal.id);

    expect(updated.files).toHaveLength(1);
    expect(stored?.files).toHaveLength(1);
    expect(audit.entries.some((entry) => entry.action === 'file_judgement_failed')).toBe(false);
    expect(stored?.judgements).toHaveLength(0);
  });

  it('allows replacing an already uploaded file while proposal is still in_upload', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn().mockResolvedValue(createJudgement('proposal-judgement', 'proposal', 'proposal-id')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();

    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Proposal with corrected file',
        description: 'Post-checks can replace files before finalization.',
        category: 'automation',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'progress/konsolidiert.md',
        content: Buffer.from('old workspace reference'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    const updated = await useCase.attachFile(
      proposal.id,
      {
        path: 'progress/konsolidiert.md',
        content: Buffer.from('normalized package reference'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    const storedFile = await storage.readProposalFile(proposal.id, 'progress/konsolidiert.md');

    expect(updated.files).toHaveLength(1);
    expect(updated.files[0]?.path).toBe('progress/konsolidiert.md');
    expect(storedFile?.content.toString('utf-8')).toBe('normalized package reference');
    expect(audit.entries.some((entry) => entry.action === 'replace_proposal_file')).toBe(true);
  });

  it('allows updating proposal metadata while proposal is still in_upload', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn().mockResolvedValue(createJudgement('proposal-judgement', 'proposal', 'proposal-id')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();

    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Original proposal',
        description: 'Original description',
        category: 'automation',
      },
      'agent'
    );

    const updated = await useCase.updateProposalMetadata(
      proposal.id,
      {
        title: 'Corrected proposal',
        description: 'Corrected description',
        tags: ['Benchmark'],
        capabilities: ['PowerPoint'],
        entrypoint: 'SKILL.md',
      },
      'agent'
    );

    expect(updated.title).toBe('Corrected proposal');
    expect(updated.description).toBe('Corrected description');
    expect(updated.tags).toEqual(['benchmark']);
    expect(updated.capabilities).toEqual(['powerpoint']);
    expect(updated.entrypoint).toBe('SKILL.md');
    expect(audit.entries.some((entry) => entry.action === 'update_proposal_metadata')).toBe(true);
  });

  it('rejects metadata updates after upload finalization', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn().mockResolvedValue(createJudgement('proposal-judgement', 'proposal', 'proposal-id')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();

    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Finalized proposal',
        description: 'Finalized description',
        category: 'automation',
        entrypoint: 'SKILL.md',
      },
      'agent'
    );
    await useCase.attachFile(
      proposal.id,
      {
        path: 'SKILL.md',
        content: Buffer.from('# skill'),
        mimeType: 'text/markdown',
      },
      'agent'
    );
    await useCase.finalizeUpload(proposal.id, 'agent');

    await expect(useCase.updateProposalMetadata(proposal.id, { title: 'Too late' }, 'agent')).rejects.toMatchObject({
      name: 'ProposalUploadNotOpenError',
    });
  });

  it('finalizes the upload and then runs proposal and file judgements', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi
        .fn()
        .mockResolvedValueOnce(createJudgement('proposal-judgement', 'proposal', 'proposal-id'))
        .mockResolvedValueOnce(createJudgement('file-judgement', 'file', 'proposal-id:README.md')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();

    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Finalize proposal upload',
        description: 'Judgements should run only after finalization.',
        category: 'automation',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'README.md',
        content: Buffer.from('# test'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    const finalized = await useCase.finalizeUpload(proposal.id, 'agent');

    expect(finalized.proposal.status).toBe('judged');
    expect(finalized.proposal.judgements).toHaveLength(2);
    expect(finalized.autoPublish.enabled).toBe(false);
    expect(audit.entries.some((entry) => entry.action === 'finalize_proposal_upload')).toBe(true);
    expect(judger.judge).toHaveBeenCalledTimes(2);
  });

  it('persists extracted content for extractable proposal files during finalize-upload and judges that extracted text', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi
        .fn()
        .mockResolvedValueOnce(createJudgement('proposal-judgement', 'proposal', 'proposal-id'))
        .mockResolvedValueOnce(createJudgement('file-judgement', 'file', 'proposal-id:templates/deck.pptx')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner('Extracted PPTX text');

    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Finalize proposal upload',
        description: 'Judgements should run only after finalization.',
        category: 'automation',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'templates/deck.pptx',
        content: Buffer.from('pptx'),
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
      'agent'
    );

    await useCase.finalizeUpload(proposal.id, 'agent');

    expect(storage.proposalExtracts.get(`${proposal.id}:templates/deck.pptx`)?.text).toBe('Extracted PPTX text');
    expect(judger.judge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'file',
        id: `${proposal.id}:templates/deck.pptx`,
        text: 'Extracted PPTX text',
      })
    );
  });

  it('rejects finalize-upload when text files still reference outside-root paths', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();

    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        skillId: 'benchmark-deck-builder',
        title: 'Benchmark Deck Builder',
        description: 'Reference integrity should be checked.',
        category: 'product-research',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'SKILL.md',
        content: Buffer.from('Use `.cursor/skills/benchmark-deck-builder/scripts/build-benchmark-ppt.py` for PPT generation.'),
        mimeType: 'text/markdown',
      },
      'agent'
    );
    await useCase.attachFile(
      proposal.id,
      {
        path: 'scripts/build-benchmark-ppt.py',
        content: Buffer.from('print("ok")'),
        mimeType: 'text/x-python',
      },
      'agent'
    );

    await expect(useCase.finalizeUpload(proposal.id, 'agent')).rejects.toBeInstanceOf(ProposalUploadValidationError);
  });

  it('does not treat slash-separated prose as missing package references', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn()
        .mockResolvedValueOnce(createJudgement('proposal-judgement', 'proposal', 'proposal-id'))
        .mockResolvedValueOnce(createJudgement('file-judgement', 'file', 'proposal-id:progress/konsolidiert.md')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Slash prose',
        description: 'Slash-separated prose should not block finalization.',
        category: 'product-research',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'progress/konsolidiert.md',
        content: Buffer.from('Normal prose mentions S2/S3/results-page, cookie/modal-layer, and provider-A/provider-B.'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    await expect(useCase.finalizeUpload(proposal.id, 'agent')).resolves.toBeTruthy();
  });

  it('does not treat HTTP protocol versions as missing package references', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn()
        .mockResolvedValueOnce(createJudgement('proposal-judgement', 'proposal', 'proposal-id'))
        .mockResolvedValueOnce(createJudgement('file-judgement', 'file', 'proposal-id:SKILL.md')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'HTTP protocol reference',
        description: 'Protocol versions in prose are not package paths.',
        category: 'api-integration',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'SKILL.md',
        content: Buffer.from('| curl flag | protocol |\n| --- | --- |\n| `--http1.1` | HTTP/1.1 |\n'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    const validation = await useCase.validateUpload(proposal.id, 'agent');

    expect(validation.valid).toBe(true);
    expect(validation.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ candidate: 'HTTP/1.1' }),
    ]));
    await expect(useCase.finalizeUpload(proposal.id, 'agent')).resolves.toBeTruthy();
  });

  it('allows finalize-upload when text files document external legacy workspace artifacts', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Outside root reference',
        description: 'Documentation-only external artifacts should warn without blocking upload.',
        category: 'product-research',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'SKILL.md',
        content: Buffer.from('Uses `CursorProjects/example-project/benchmarks/example/output.pptx` as a required template.'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    const validation = await useCase.validateUpload(proposal.id, 'agent');

    expect(validation.valid).toBe(true);
    expect(validation.findings).toEqual([
      expect.objectContaining({
        kind: 'external_reference',
        severity: 'warning',
        blocksFinalize: false,
        candidate: 'CursorProjects/example-project/benchmarks/example/output.pptx',
      }),
    ]);
    await expect(useCase.finalizeUpload(proposal.id, 'agent')).resolves.toBeTruthy();
  });

  it('validates open proposal uploads without finalizing or judging', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Validate-only proposal upload',
        description: 'Validation should not finalize or judge.',
        category: 'automation',
        entrypoint: 'SKILL.md',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'SKILL.md',
        content: Buffer.from('Use `.cursor/skills/demo/scripts/run.py` and `missing/example.json`.'),
        mimeType: 'text/markdown',
      },
      'agent'
    );
    await useCase.attachFile(
      proposal.id,
      {
        path: 'scripts/run.py',
        content: Buffer.from('print("ok")'),
        mimeType: 'text/x-python',
      },
      'agent'
    );

    const validation = await useCase.validateUpload(proposal.id, 'agent');
    const stored = await repo.findProposalById(proposal.id);

    expect(validation).toMatchObject({
      proposalId: proposal.id,
      status: 'in_upload',
      valid: false,
      fileCount: 2,
      checkedTextFileCount: 2,
    });
    expect(validation.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'outside_root_reference',
        severity: 'error',
        blocksFinalize: true,
        file: 'SKILL.md',
        line: 1,
        candidate: '.cursor/skills/demo/scripts/run.py',
        suggestedReplacement: 'scripts/run.py',
      }),
      expect.objectContaining({
        kind: 'missing_package_reference',
        severity: 'error',
        blocksFinalize: true,
        file: 'SKILL.md',
        line: 1,
        candidate: 'missing/example.json',
        suggestedReplacement: null,
      }),
    ]));
    expect(stored?.status).toBe('in_upload');
    expect(judger.judge).not.toHaveBeenCalled();
  });

  it('reports external legacy references and runtime command references as non-blocking warnings', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn()
        .mockResolvedValueOnce(createJudgement('proposal-judgement', 'proposal', 'proposal-id'))
        .mockResolvedValueOnce(createJudgement('file-judgement', 'file', 'proposal-id:SKILL.md')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'External references',
        description: 'Legacy references should not hard-block finalization.',
        category: 'automation',
        entrypoint: 'SKILL.md',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'SKILL.md',
        content: Buffer.from('Legacy docs mention `CursorProjects/example-project/scripts/` and `.cursor/commands/benchmark-deck.md`.'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    const validation = await useCase.validateUpload(proposal.id, 'agent');

    expect(validation.valid).toBe(true);
    expect(validation.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'external_reference',
        severity: 'warning',
        blocksFinalize: false,
        candidate: 'CursorProjects/example-project/scripts/',
      }),
      expect.objectContaining({
        kind: 'portable_command_missing',
        severity: 'warning',
        blocksFinalize: false,
        candidate: '.cursor/commands/benchmark-deck.md',
        suggestedReplacement: 'commands/benchmark-deck.md',
      }),
    ]));
    await expect(useCase.finalizeUpload(proposal.id, 'agent')).resolves.toBeTruthy();
  });

  it('suggests package-relative portable command references when command files already exist', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn()
        .mockResolvedValueOnce(createJudgement('proposal-judgement', 'proposal', 'proposal-id'))
        .mockResolvedValueOnce(createJudgement('file-judgement', 'file', 'proposal-id:SKILL.md'))
        .mockResolvedValueOnce(createJudgement('file-judgement', 'file', 'proposal-id:commands/benchmark-deck.md')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Portable command reference',
        description: 'Runtime command paths should point to packaged commands.',
        category: 'automation',
        entrypoint: 'SKILL.md',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'SKILL.md',
        content: Buffer.from('Run the optional shortcut from `.cursor/commands/benchmark-deck.md`.'),
        mimeType: 'text/markdown',
      },
      'agent'
    );
    await useCase.attachFile(
      proposal.id,
      {
        path: 'commands/benchmark-deck.md',
        content: Buffer.from('# Competitor benchmark command'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    const validation = await useCase.validateUpload(proposal.id, 'agent');

    expect(validation.valid).toBe(true);
    expect(validation.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'portable_command_manifest_missing',
        severity: 'warning',
        blocksFinalize: false,
        candidate: 'commands/',
        suggestedReplacement: 'commands/manifest.json',
      }),
      expect.objectContaining({
        kind: 'portable_command_reference',
        severity: 'warning',
        blocksFinalize: false,
        candidate: '.cursor/commands/benchmark-deck.md',
        suggestedReplacement: 'commands/benchmark-deck.md',
      }),
    ]));
    await expect(useCase.finalizeUpload(proposal.id, 'agent')).resolves.toBeTruthy();
  });

  it('does not warn about a missing portable command manifest when commands/manifest.json exists', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Portable command manifest',
        description: 'Existing command manifests should be preserved.',
        category: 'automation',
        entrypoint: 'SKILL.md',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'SKILL.md',
        content: Buffer.from('Use `commands/benchmark-deck.md` as an optional shortcut.'),
        mimeType: 'text/markdown',
      },
      'agent'
    );
    await useCase.attachFile(
      proposal.id,
      {
        path: 'commands/benchmark-deck.md',
        content: Buffer.from('# Competitor benchmark command'),
        mimeType: 'text/markdown',
      },
      'agent'
    );
    await useCase.attachFile(
      proposal.id,
      {
        path: 'commands/manifest.json',
        content: Buffer.from('{"schemaVersion":"1.0","commands":[{"id":"benchmark-deck","source":"commands/benchmark-deck.md","runtimeTargets":[{"runtime":"cursor","installHint":".cursor/commands/benchmark-deck.md"}]}]}'),
        mimeType: 'application/json',
      },
      'agent'
    );

    const validation = await useCase.validateUpload(proposal.id, 'agent');

    expect(validation.valid).toBe(true);
    expect(validation.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'portable_command_manifest_missing',
      }),
      expect.objectContaining({
        kind: 'portable_command_missing',
      }),
    ]));
  });

  it('reports inconsistent portable command manifests as non-blocking warnings', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Invalid command manifest',
        description: 'Manifest inconsistencies should guide agents without blocking finalization.',
        category: 'automation',
        entrypoint: 'SKILL.md',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'SKILL.md',
        content: Buffer.from('Use the portable command package.'),
        mimeType: 'text/markdown',
      },
      'agent'
    );
    await useCase.attachFile(
      proposal.id,
      {
        path: 'commands/manifest.json',
        content: Buffer.from('{"schemaVersion":"1.0","commands":[{"id":"missing","source":"commands/missing.md"},{"id":"missing","source":"legacy.md"}]}'),
        mimeType: 'application/json',
      },
      'agent'
    );

    const validation = await useCase.validateUpload(proposal.id, 'agent');

    expect(validation.valid).toBe(true);
    expect(validation.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'portable_command_manifest_invalid',
        severity: 'warning',
        blocksFinalize: false,
        candidate: 'commands/missing.md',
      }),
      expect.objectContaining({
        kind: 'portable_command_manifest_invalid',
        severity: 'warning',
        blocksFinalize: false,
        candidate: 'missing',
      }),
      expect.objectContaining({
        kind: 'portable_command_manifest_invalid',
        severity: 'warning',
        blocksFinalize: false,
        candidate: 'legacy.md',
        suggestedReplacement: 'commands/legacy.md',
      }),
    ]));
  });

  it('does not hard-block variable placeholder paths as missing package files', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn()
        .mockResolvedValueOnce(createJudgement('proposal-judgement', 'proposal', 'proposal-id'))
        .mockResolvedValueOnce(createJudgement('file-judgement', 'file', 'proposal-id:SKILL.md')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Placeholder output paths',
        description: 'Runtime output placeholders should not require package files.',
        category: 'automation',
        entrypoint: 'SKILL.md',
      },
      'agent'
    );

    await useCase.attachFile(
      proposal.id,
      {
        path: 'SKILL.md',
        content: Buffer.from('Outputs `{output}/screenshots/{anbieter-slug}-bot-sperre.png` during runtime.'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    const validation = await useCase.validateUpload(proposal.id, 'agent');

    expect(validation.valid).toBe(true);
    expect(validation.findings).toEqual([]);
    await expect(useCase.finalizeUpload(proposal.id, 'agent')).resolves.toBeTruthy();
  });

  it('allows deleting an in-upload proposal as upload abort', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);
    const proposal = await useCase.submitProposal(
      {
        title: 'Abortable proposal',
        description: 'Can be deleted before finalization.',
        category: 'automation',
      },
      'agent'
    );

    await useCase.deleteProposal(proposal.id, 'agent');

    expect(await repo.findProposalById(proposal.id)).toBeNull();
    expect(audit.entries.some((entry) => entry.action === 'delete_proposal')).toBe(true);
  });

  it('rejects access to an open upload from a different submitting actor', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, new StubScanner());
    const proposal = await useCase.submitProposal(
      { title: 'Owned upload', description: 'Only its submitter may change it.', category: 'automation' },
      'owner-agent'
    );

    await expect(useCase.updateProposalMetadata(proposal.id, { title: 'Hijacked' }, 'other-agent'))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(useCase.attachFile(proposal.id, {
      path: 'SKILL.md',
      content: Buffer.from('# Hijacked'),
      mimeType: 'text/markdown',
    }, 'other-agent')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(useCase.validateUpload(proposal.id, 'other-agent')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(useCase.finalizeUpload(proposal.id, 'other-agent')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(useCase.deleteProposal(proposal.id, 'other-agent')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects files beyond the configured file count limit', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner, undefined, {
      maxFiles: 1,
      maxFileSizeBytes: 1024,
      disallowedPathPrefixes: ['node_modules/'],
    });

    const proposal = await useCase.submitProposal(
      { title: 'Limit test', description: 'Only one file allowed.', category: 'automation' },
      'agent'
    );
    await useCase.attachFile(
      proposal.id,
      { path: 'README.md', content: Buffer.from('a'), mimeType: 'text/markdown' },
      'agent'
    );

    await expect(
      useCase.attachFile(
        proposal.id,
        { path: 'SECOND.md', content: Buffer.from('b'), mimeType: 'text/markdown' },
        'agent'
      )
    ).rejects.toBeInstanceOf(ProposalFileLimitExceededError);
  });

  it('rejects files larger than the configured size limit', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner, undefined, {
      maxFiles: 30,
      maxFileSizeBytes: 1,
      disallowedPathPrefixes: ['node_modules/'],
    });

    const proposal = await useCase.submitProposal(
      { title: 'Size test', description: 'One byte max.', category: 'automation' },
      'agent'
    );

    await expect(
      useCase.attachFile(
        proposal.id,
        { path: 'README.md', content: Buffer.from('ab'), mimeType: 'text/markdown' },
        'agent'
      )
    ).rejects.toBeInstanceOf(ProposalFileSizeLimitExceededError);
  });

  it('rejects blocked dependency-tree paths', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner, undefined, {
      maxFiles: 30,
      maxFileSizeBytes: 1024,
      disallowedPathPrefixes: ['node_modules/', '.venv/'],
    });

    const proposal = await useCase.submitProposal(
      { title: 'Path test', description: 'Blocked paths fail.', category: 'automation' },
      'agent'
    );

    await expect(
      useCase.attachFile(
        proposal.id,
        { path: 'node_modules/pkg/index.js', content: Buffer.from('a'), mimeType: 'text/javascript' },
        'agent'
      )
    ).rejects.toBeInstanceOf(ProposalDisallowedPathError);
  });

  it('rejects dot-segment traversal or workspace-relative upload paths', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);

    const proposal = await useCase.submitProposal(
      { title: 'Traversal test', description: 'Reject parent traversal.', category: 'automation' },
      'agent'
    );

    await expect(
      useCase.attachFile(
        proposal.id,
        { path: '../secret.txt', content: Buffer.from('a'), mimeType: 'text/plain' },
        'agent'
      )
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      useCase.attachFile(
        proposal.id,
        { path: './SKILL.md', content: Buffer.from('a'), mimeType: 'text/markdown' },
        'agent'
      )
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      useCase.attachFile(
        proposal.id,
        { path: 'scripts/../../evil.sh', content: Buffer.from('a'), mimeType: 'text/x-shellscript' },
        'agent'
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects absolute Windows and UNC-style upload paths', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);

    const proposal = await useCase.submitProposal(
      { title: 'Windows path test', description: 'Reject absolute roots.', category: 'automation' },
      'agent'
    );

    await expect(
      useCase.attachFile(
        proposal.id,
        { path: 'C:\\temp\\skill\\SKILL.md', content: Buffer.from('a'), mimeType: 'text/markdown' },
        'agent'
      )
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      useCase.attachFile(
        proposal.id,
        { path: '\\\\server\\share\\skill\\SKILL.md', content: Buffer.from('a'), mimeType: 'text/markdown' },
        'agent'
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('normalizes repeated separators and backslashes for valid relative package paths', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = { judge: vi.fn() } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner);

    const proposal = await useCase.submitProposal(
      { title: 'Normalize path test', description: 'Normalize separators.', category: 'automation' },
      'agent'
    );

    const updated = await useCase.attachFile(
      proposal.id,
      { path: 'scripts\\\\nested//build.py', content: Buffer.from('a'), mimeType: 'text/x-python' },
      'agent'
    );

    expect(updated.files[0]?.path).toBe('scripts/nested/build.py');
  });

  it('loads the proposal aggregate for file attachment from the repository before catalog fallback', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn().mockResolvedValue(createJudgement('file-judgement', 'file', 'proposal-1:README.md')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const catalog = new ProposalCatalog({
      ...createCatalogProposal(),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    const sourceCreatedAt = new Date('2026-07-12T16:05:14.284Z');
    await repo.saveProposal(
      Proposal.create({
        id: 'proposal-1',
        title: 'Source proposal',
        description: 'Loaded from repository',
        category: 'automation',
        entrypoint: 'README.md',
        submittedBy: 'agent',
        createdAt: sourceCreatedAt,
      })
    );

    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner, catalog);

    const updated = await useCase.attachFile(
      'proposal-1',
      {
        path: 'README.md',
        content: Buffer.from('# test'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    expect(repo.findProposalByIdCalls).toBe(1);
    expect(catalog.getProposalCalls).toBe(0);
    expect(updated.createdAt).toEqual(sourceCreatedAt);
    expect(repo.lastSavedProposal?.createdAt).toEqual(sourceCreatedAt);
  });

  it('falls back to the sqlite catalog when the repository has no proposal aggregate', async () => {
    const repo = new InMemorySkillRepository();
    const storage = new InMemoryStorage();
    const audit = new InMemoryAuditLog();
    const judger = {
      judge: vi.fn().mockResolvedValue(createJudgement('file-judgement', 'file', 'proposal-1:README.md')),
    } satisfies SkillJudgerPort;
    const scanner = new StubScanner();
    const catalog = new ProposalCatalog(createCatalogProposal());

    const useCase = new SubmitProposalUseCase(repo, storage, audit, judger, scanner, catalog);

    const updated = await useCase.attachFile(
      'proposal-1',
      {
        path: 'README.md',
        content: Buffer.from('# test'),
        mimeType: 'text/markdown',
      },
      'agent'
    );

    expect(repo.findProposalByIdCalls).toBe(1);
    expect(catalog.getProposalCalls).toBe(1);
    expect(updated.files).toHaveLength(2);
    expect(updated.judgements).toHaveLength(1);
    expect(repo.lastSavedProposal?.files).toHaveLength(2);
  });
});

class InMemorySkillRepository implements SkillRepositoryPort {
  private proposals = new Map<string, Proposal>();
  findProposalByIdCalls = 0;
  lastSavedProposal: Proposal | null = null;

  async save(): Promise<void> {}
  async findById(): Promise<null> {
    return null;
  }
  async findAll(): Promise<{ items: []; total: number }> {
    return { items: [], total: 0 };
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async saveProposal(proposal: Proposal): Promise<void> {
    this.proposals.set(proposal.id, proposal);
    this.lastSavedProposal = proposal;
  }
  async findProposalById(id: string): Promise<Proposal | null> {
    this.findProposalByIdCalls += 1;
    return this.proposals.get(id) ?? null;
  }
  async findProposals(): Promise<{ items: Proposal[]; total: number }> {
    const items = [...this.proposals.values()];
    return { items, total: items.length };
  }
  async deleteProposal(id: string): Promise<void> {
    this.proposals.delete(id);
  }
}

class InMemoryStorage implements SkillFileStoragePort {
  private readonly proposalFiles = new Map<string, { content: Buffer; mimeType: string }>();
  readonly proposalExtracts = new Map<string, StoredExtractedContent>();

  async storeSkillFile(): Promise<StoredFile> {
    throw new Error('not implemented');
  }
  async readSkillFile(): Promise<null> {
    return null;
  }
  async listSkillFiles(): Promise<StoredFile[]> {
    return [];
  }
  async storeSkillFileExtract(): Promise<StoredExtractedContent> {
    throw new Error('not implemented');
  }
  async readSkillFileExtract(): Promise<StoredExtractedContent | null> {
    return null;
  }
  async storeProposalFile(_proposalId: string, path: string, content: Buffer, mimeType: string): Promise<StoredFile> {
    this.proposalFiles.set(`${_proposalId}:${path}`, { content, mimeType });
    return {
      path,
      mimeType,
      sizeBytes: content.length,
      sha256: 'sha256',
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    };
  }
  async readProposalFile(proposalId: string, filePath: string): Promise<{ content: Buffer; mimeType: string } | null> {
    return this.proposalFiles.get(`${proposalId}:${filePath}`) ?? null;
  }
  async listProposalFiles(): Promise<StoredFile[]> {
    return [];
  }
  async storeProposalFileExtract(
    proposalId: string,
    path: string,
    extracted: Omit<StoredExtractedContent, 'extractedAt'> & { extractedAt?: Date }
  ): Promise<StoredExtractedContent> {
    const stored = {
      text: extracted.text,
      extractedBy: extracted.extractedBy,
      metadata: extracted.metadata,
      extractedAt: extracted.extractedAt ?? new Date('2026-07-02T00:00:00.000Z'),
    };
    this.proposalExtracts.set(`${proposalId}:${path}`, stored);
    return stored;
  }
  async readProposalFileExtract(proposalId: string, path: string): Promise<StoredExtractedContent | null> {
    return this.proposalExtracts.get(`${proposalId}:${path}`) ?? null;
  }
}

class InMemoryAuditLog implements AuditLogPort {
  readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async findBySkillId(): Promise<AuditEntry[]> {
    return [];
  }
  async findByProposalId(): Promise<AuditEntry[]> {
    return [];
  }
  async findAll(): Promise<AuditEntry[]> {
    return this.entries;
  }
}

class StubScanner implements FileScannerPort {
  constructor(private readonly text = 'scanned file text') {}
  supports(): boolean {
    return true;
  }

  async scan(): Promise<{ text: string; metadata: Record<string, unknown>; extractedBy: string }> {
    return {
      text: this.text,
      metadata: {},
      extractedBy: 'stub',
    };
  }
}

class ProposalCatalog implements SkillCatalogPort {
  getProposalCalls = 0;

  constructor(private readonly proposal: CatalogProposalRecord) {}

  async upsertSkill(_skill: Skill): Promise<void> {}
  async upsertProposal(_proposal: Proposal): Promise<void> {}
  async deleteProposal(_proposalId: string): Promise<void> {}
  async upsertSkillJudgement(): Promise<void> {}
  async listJudgements() { return []; }
  async upsertAuditEntry() {}
  async listSkillHistory() { return []; }
  async listProposals(): Promise<{ items: CatalogProposalRecord[]; total: number }> {
    return { items: [this.proposal], total: 1 };
  }
  async getProposal(proposalId: string): Promise<CatalogProposalRecord | null> {
    this.getProposalCalls += 1;
    return this.proposal.id === proposalId ? this.proposal : null;
  }
  async listProposalFiles() {
    return [
      {
        proposalId: this.proposal.id,
        id: 'existing.md',
        path: 'existing.md',
        mimeType: 'text/markdown',
        sizeBytes: 12,
        sha256: 'sha-existing',
      },
    ];
  }
  async listProposalJudgements() {
    return [
      {
        id: 'existing-judgement',
        targetType: 'proposal' as const,
        targetId: this.proposal.id,
        proposalId: this.proposal.id,
        skillId: null,
        skillVersion: null,
        dimensions: {
          safety: {
            risk: JudgementRisk.LOW,
            score: 0.1,
            reason: 'existing',
          },
        },
        overallRisk: JudgementRisk.LOW,
        summary: 'existing',
        model: 'stub',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ];
  }
  async countPendingProposals() { return 0; }
  async rebuild(): Promise<void> {}
  async listCategories(): Promise<string[]> { return []; }
  async listLatestSkillVersions() { return { items: [], total: 0 }; }
  async listPublishedSkillRefs() { return { items: [], total: 0 }; }
  async getSkillVersion() { return null; }
  async getLatestVersion() { return null; }
  async getLatestPublishedVersion() { return null; }
  async listSkillVersions() { return []; }
  async listPublishedVersions() { return []; }
  async listVersionFiles() { return []; }
}

function createJudgement(id: string, targetType: 'proposal' | 'file' | 'skill', targetId: string) {
  return {
    id,
    targetType,
    targetId,
    dimensions: {
      harmful: { risk: 'low', score: 0, reason: 'safe' },
      promptInjection: { risk: 'low', score: 0, reason: 'safe' },
      dataExfiltration: { risk: 'low', score: 0, reason: 'safe' },
      policyViolation: { risk: 'low', score: 0, reason: 'safe' },
    },
    overallRisk: 'low',
    summary: 'safe',
    model: 'stub',
    createdAt: new Date(),
  } as const;
}

function createCatalogProposal(): CatalogProposalRecord {
  return {
    id: 'proposal-1',
    skillId: null,
    title: 'Catalog proposal',
    description: 'Loaded from catalog',
    category: 'automation',
    tags: [],
    capabilities: [],
    entrypoint: 'existing.md',
    status: 'in_upload',
    submittedBy: 'agent',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    rejectionReason: null,
    latestJudgementRisk: JudgementRisk.LOW,
    labels: ['safe'],
    latestJudgementId: 'existing-judgement',
    latestJudgedAt: new Date('2026-07-01T00:00:00.000Z'),
    contentDigest: 'digest',
  };
}
