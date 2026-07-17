import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { FileSystemSkillRepository } from './file-system.repository';
import { ProposalFile, Proposal } from '../../../../domain/proposal/Proposal';
import { Judgement, JudgementRisk } from '../../../../domain/judgement/Judgement';
import { Skill } from '../../../../domain/skill/Skill';
import { SkillId } from '../../../../domain/skill/SkillId';
import { SkillVersion } from '../../../../domain/skill/SkillVersion';
import { Manifest } from '../../../../domain/skill/Manifest';
import { SkillStatus } from '../../../../domain/skill/SkillStatus';

describe('FileSystemSkillRepository', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('rehydrates proposal judgements from persisted YAML', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-repo-'));
    tempDirs.push(dataDir);

    const repo = new FileSystemSkillRepository(dataDir);
    let proposal = Proposal.create({
      title: 'Persisted Proposal',
      description: 'Checks judgement rehydration',
      category: 'automation',
      submittedBy: 'tester',
      idempotencyKeyHash: 'idempotency-hash',
      artifactDecisions: [{
        reference: '/portable-command',
        classification: 'ambiguous_dependency',
        decision: 'keep_external_prerequisite',
        confirmation: 'explicit_user_choice',
        source: '/portable-command',
        target: null,
        rationale: 'The submitter explicitly kept the command external.',
      }],
    });
    proposal = proposal.addFile(
      ProposalFile.create({
        id: 'README.md',
        path: 'README.md',
        mimeType: 'text/markdown',
        sizeBytes: 42,
        sha256: 'sha256',
      })
    );
    proposal = proposal.addJudgement(
      Judgement.create({
        id: 'judge-1',
        targetType: 'proposal',
        targetId: proposal.id,
        dimensions: {
          harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
          promptInjection: { risk: JudgementRisk.MEDIUM, score: 0.4, reason: 'suspicious' },
          dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
          policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
        },
        summary: 'Stored judgement',
        model: 'custom-judger:example-alias@version-1',
      })
    );

    await repo.saveProposal(proposal);

    const loaded = await repo.findProposalById(proposal.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.status).toBe('judged');
    expect(loaded?.files).toHaveLength(1);
    expect(loaded?.judgements).toHaveLength(1);
    expect(loaded?.judgements[0]?.summary).toBe('Stored judgement');
    expect(loaded?.judgements[0]?.dimensions.promptInjection.risk).toBe(JudgementRisk.MEDIUM);
    expect(loaded?.idempotencyKeyHash).toBe('idempotency-hash');
    expect(loaded?.artifactDecisions).toEqual([
      expect.objectContaining({
        reference: '/portable-command',
        decision: 'keep_external_prerequisite',
        confirmation: 'explicit_user_choice',
      }),
    ]);
  });

  it('restores the latest published version when loading a skill from disk', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-repo-'));
    tempDirs.push(dataDir);

    const repo = new FileSystemSkillRepository(dataDir);
    const skill = Skill.create({ id: SkillId.create('published-skill'), createdBy: 'tester' });
    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: '1.0.0',
        createdBy: 'tester',
        manifest: Manifest.create({
          id: 'published-skill',
          title: 'Published Skill',
          description: 'Should stay published after reload',
          version: '1.0.0',
          status: SkillStatus.PUBLISHED,
          category: 'automation',
          entrypoint: 'README.md',
          files: [],
        }),
      })
    );
    skill.setLatestPublished('1.0.0');

    await repo.save(skill);

    const loaded = await repo.findById('published-skill');

    expect(loaded).not.toBeNull();
    expect(loaded?.getLatestPublishedVersion()?.version).toBe('1.0.0');
  });
});
