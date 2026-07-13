import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { SqliteSkillCatalog } from './sqlite.skill-catalog';
import { Skill } from '../../../../domain/skill/Skill';
import { SkillId } from '../../../../domain/skill/SkillId';
import { SkillVersion } from '../../../../domain/skill/SkillVersion';
import { Manifest } from '../../../../domain/skill/Manifest';
import { ManifestFile } from '../../../../domain/skill/ManifestFile';
import { SkillStatus } from '../../../../domain/skill/SkillStatus';
import { AuditEntry } from '../../../../domain/audit/AuditEntry';
import { Proposal } from '../../../../domain/proposal/Proposal';
import { ProposalFile } from '../../../../domain/proposal/Proposal';
import { Judgement, JudgementRisk } from '../../../../domain/judgement/Judgement';

describe('SqliteSkillCatalog', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('projects categories, published refs and file metadata into sqlite', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-catalog-'));
    tempDirs.push(dataDir);
    await mkdir(path.join(dataDir, 'skills', 'catalog-skill', '1.0.0'), { recursive: true });
    await writeFile(
      path.join(dataDir, 'skills', 'catalog-skill', '1.0.0', '.meta.json'),
      JSON.stringify(
        {
          'README.md': {
            mimeType: 'text/markdown',
            sizeBytes: 14,
            sha256: 'abc123',
            updatedAt: '2026-07-02T12:00:00.000Z',
          },
        },
        null,
        2
      )
    );

    const catalog = new SqliteSkillCatalog(dataDir, path.join(dataDir, 'index', 'search.db'));
    const skill = Skill.create({ id: SkillId.create('catalog-skill'), createdBy: 'tester' });
    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: '1.0.0',
        createdBy: 'tester',
        manifest: Manifest.create({
          id: 'catalog-skill',
          title: 'Catalog Skill',
          description: 'Projected into SQLite',
          version: '1.0.0',
          status: SkillStatus.PUBLISHED,
          category: 'automation',
          tags: ['agent'],
          useWhen: ['Use when catalog-backed'],
          doNotUseWhen: ['Do not use blindly'],
          entrypoint: 'README.md',
          files: [
            ManifestFile.create({
              path: 'README.md',
              role: 'entrypoint',
              mimeType: 'text/markdown',
              sha256: 'abc123',
            }),
          ],
        }),
      })
    );
    skill.setLatestPublished('1.0.0');

    await catalog.upsertSkill(skill);

    const categories = await catalog.listCategories();
    const tags = await catalog.listTags();
    const refs = await catalog.listPublishedSkillRefs();
    const latest = await catalog.getLatestPublishedVersion('catalog-skill');
    const exact = await catalog.getSkillVersion('catalog-skill', '1.0.0');
    const latestAny = await catalog.getLatestVersion('catalog-skill');
    const latestList = await catalog.listLatestSkillVersions();
    const versions = await catalog.listSkillVersions('catalog-skill');
    const files = await catalog.listVersionFiles('catalog-skill', '1.0.0');

    expect(categories).toEqual(['automation']);
    expect(tags).toEqual(['agent']);
    expect(refs.items).toEqual([{ skillId: 'catalog-skill', version: '1.0.0' }]);
    expect(latest?.contentDigest).toBeTruthy();
    expect(exact?.version).toBe('1.0.0');
    expect(latestAny?.version).toBe('1.0.0');
    expect(latestList.items).toHaveLength(1);
    expect(latestList.items[0]?.isLatestVersion).toBe(true);
    expect(latest?.entrypoint).toBe('README.md');
    expect(latest?.useWhen).toEqual(['Use when catalog-backed']);
    expect(versions[0]?.createdAt).toBeInstanceOf(Date);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('README.md');
    expect(files[0]?.extractable).toBe(true);
    expect(files[0]?.sizeBytes).toBe(14);
  });
  it('lists the latest published version even when a newer draft exists', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-catalog-'));
    tempDirs.push(dataDir);
    await mkdir(path.join(dataDir, 'skills', 'catalog-skill', '1.0.0'), { recursive: true });
    await mkdir(path.join(dataDir, 'skills', 'catalog-skill', '1.0.1'), { recursive: true });
    await writeFile(
      path.join(dataDir, 'skills', 'catalog-skill', '1.0.0', '.meta.json'),
      JSON.stringify(
        {
          'README.md': {
            mimeType: 'text/markdown',
            sizeBytes: 14,
            sha256: 'abc123',
            updatedAt: '2026-07-02T12:00:00.000Z',
          },
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(dataDir, 'skills', 'catalog-skill', '1.0.1', '.meta.json'),
      JSON.stringify(
        {
          'README.md': {
            mimeType: 'text/markdown',
            sizeBytes: 14,
            sha256: 'abc123',
            updatedAt: '2026-07-02T12:00:00.000Z',
          },
        },
        null,
        2
      )
    );

    const catalog = new SqliteSkillCatalog(dataDir, path.join(dataDir, 'index', 'search.db'));
    const skill = Skill.create({ id: SkillId.create('catalog-skill'), createdBy: 'tester' });
    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: '1.0.0',
        createdBy: 'tester',
        manifest: Manifest.create({
          id: 'catalog-skill',
          title: 'Catalog Skill',
          description: 'Projected into SQLite',
          version: '1.0.0',
          status: SkillStatus.PUBLISHED,
          category: 'automation',
          tags: ['agent'],
          entrypoint: 'README.md',
          files: [
            ManifestFile.create({
              path: 'README.md',
              role: 'entrypoint',
              mimeType: 'text/markdown',
              sha256: 'abc123',
            }),
          ],
        }),
      })
    );
    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: '1.0.1',
        createdBy: 'tester',
        manifest: Manifest.create({
          id: 'catalog-skill',
          title: 'Catalog Skill Draft',
          description: 'Newer draft',
          version: '1.0.1',
          status: SkillStatus.DRAFT,
          category: 'automation',
          tags: ['agent'],
          entrypoint: 'README.md',
          files: [
            ManifestFile.create({
              path: 'README.md',
              role: 'entrypoint',
              mimeType: 'text/markdown',
              sha256: 'abc123',
            }),
          ],
        }),
      })
    );
    skill.setLatestPublished('1.0.0');

    await catalog.upsertSkill(skill);

    const latestAny = await catalog.listLatestSkillVersions();
    expect(latestAny.items).toHaveLength(1);
    expect(latestAny.items[0]?.version).toBe('1.0.1');
    expect(latestAny.items[0]?.status).toBe('draft');

    const latestPublished = await catalog.listLatestSkillVersions({ publishedOnly: true });
    expect(latestPublished.items).toHaveLength(1);
    expect(latestPublished.items[0]?.version).toBe('1.0.0');
    expect(latestPublished.items[0]?.status).toBe('published');
  });


  it('projects proposal, file and skill judgements into sqlite', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-catalog-'));
    tempDirs.push(dataDir);

    const catalog = new SqliteSkillCatalog(dataDir, path.join(dataDir, 'index', 'search.db'));
    let proposal = Proposal.create({
      title: 'Projected Proposal',
      description: 'Contains judgements',
      category: 'automation',
      submittedBy: 'agent',
    });
    proposal = proposal.addFile(
      ProposalFile.create({
        id: 'README.md',
        path: 'README.md',
        mimeType: 'text/markdown',
        sizeBytes: 14,
        sha256: 'abc123',
      })
    );
    proposal = Proposal.rehydrate({
      id: proposal.id,
      skillId: null,
      title: proposal.title,
      description: proposal.description,
      category: proposal.category,
      tags: proposal.tags,
      capabilities: proposal.capabilities,
      entrypoint: proposal.entrypoint,
      files: proposal.files,
      judgements: [
        createJudgement('judge-proposal', 'proposal', proposal.id),
        createJudgement('judge-file', 'file', `${proposal.id}:README.md`),
      ],
      status: 'judged',
      submittedBy: proposal.submittedBy,
      createdAt: proposal.createdAt,
      rejectionReason: null,
    });

    await catalog.upsertProposal(proposal);
    await catalog.upsertProposal(Proposal.rehydrate({
      id: 'proposal-still-uploading',
      skillId: null,
      title: 'Still Uploading',
      description: 'Not ready for admin review yet.',
      category: 'automation',
      tags: [],
      capabilities: [],
      entrypoint: null,
      files: [],
      judgements: [],
      status: 'in_upload',
      submittedBy: 'agent',
      createdAt: new Date(proposal.createdAt.getTime() + 1),
      rejectionReason: null,
    }));
    await catalog.upsertSkillJudgement(
      'catalog-skill',
      '1.0.0',
      createJudgement('judge-skill', 'skill', 'catalog-skill:1.0.0')
    );

    const proposalList = await catalog.listProposals();
    const proposalFiles = await catalog.listProposalFiles(proposal.id);
    const allProposalJudgements = await catalog.listProposalJudgements(proposal.id);
    const proposalJudgements = await catalog.listJudgements('proposal', proposal.id);
    const fileJudgements = await catalog.listJudgements('file', `${proposal.id}:README.md`);
    const skillJudgements = await catalog.listJudgements('skill', 'catalog-skill:1.0.0');
    const pendingCount = await catalog.countPendingProposals();

    expect(proposalList.total).toBe(2);
    const judgedProposal = proposalList.items.find((item) => item.id === proposal.id);
    expect(judgedProposal?.latestJudgementRisk).toBe('low');
    expect(judgedProposal?.labels).toContain('safe');
    expect(proposalFiles).toHaveLength(1);
    expect(proposalFiles[0]?.path).toBe('README.md');
    expect(proposalFiles[0]?.sizeBytes).toBe(14);
    expect(allProposalJudgements).toHaveLength(2);
    expect((await catalog.getProposal(proposal.id))?.latestJudgementId).toBe('judge-file');
    expect(proposalJudgements).toHaveLength(1);
    expect(fileJudgements).toHaveLength(1);
    expect(skillJudgements).toHaveLength(1);
    expect(skillJudgements[0]?.skillId).toBe('catalog-skill');
    expect(skillJudgements[0]?.skillVersion).toBe('1.0.0');
    expect(pendingCount).toBe(1);
  });

  it('maps noop proposal judgements to no_judge_available', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-catalog-'));
    tempDirs.push(dataDir);
    const catalog = new SqliteSkillCatalog(dataDir, path.join(dataDir, 'index', 'search.db'));

    let proposal = Proposal.create({
      title: 'Noop Candidate',
      description: 'Displays no_judge_available in catalog read paths.',
      category: 'automation',
      submittedBy: 'agent',
    });
    proposal = proposal.addFile(
      ProposalFile.create({
        id: 'README.md',
        path: 'README.md',
        mimeType: 'text/markdown',
        sizeBytes: 14,
        sha256: 'abc123',
      })
    );
    proposal = Proposal.rehydrate({
      id: proposal.id,
      skillId: null,
      title: proposal.title,
      description: proposal.description,
      category: proposal.category,
      tags: proposal.tags,
      capabilities: proposal.capabilities,
      entrypoint: proposal.entrypoint,
      files: proposal.files,
      judgements: [
        createJudgement('judge-proposal', 'proposal', proposal.id, JudgementRisk.LOW, 'noop'),
        createJudgement('judge-file', 'file', `${proposal.id}:README.md`, JudgementRisk.LOW, 'noop'),
      ],
      status: 'judged',
      submittedBy: proposal.submittedBy,
      createdAt: proposal.createdAt,
      rejectionReason: null,
    });
    await catalog.upsertProposal(proposal);

    const proposalList = await catalog.listProposals();
    const proposalRecord = await catalog.getProposal(proposal.id);
    const proposalJudgements = await catalog.listProposalJudgements(proposal.id);

    expect(proposalList.items[0]?.latestJudgementRisk).toBe('no_judge_available');
    expect(proposalRecord?.latestJudgementRisk).toBe('no_judge_available');
    expect(proposalJudgements[0]?.overallRisk).toBe('no_judge_available');
  });

  it('removes projected proposal metadata when a proposal is deleted', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-catalog-'));
    tempDirs.push(dataDir);

    const catalog = new SqliteSkillCatalog(dataDir, path.join(dataDir, 'index', 'search.db'));
    const proposal = Proposal.create({
      title: 'Delete me',
      description: 'Projected proposal metadata',
      category: 'automation',
      submittedBy: 'agent',
    });

    await catalog.upsertProposal(proposal);
    expect((await catalog.listProposals()).total).toBe(1);
    expect((await catalog.getProposal(proposal.id))?.id).toBe(proposal.id);
    expect((await catalog.listProposalFiles(proposal.id)).length).toBe(0);

    await catalog.deleteProposal(proposal.id);

    expect((await catalog.listProposals()).total).toBe(0);
    expect(await catalog.getProposal(proposal.id)).toBeNull();
    expect((await catalog.listProposalFiles(proposal.id)).length).toBe(0);
    expect((await catalog.listProposalJudgements(proposal.id)).length).toBe(0);
    expect(await catalog.countPendingProposals()).toBe(0);
  });

  it('projects skill audit history into sqlite', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-catalog-'));
    tempDirs.push(dataDir);

    const catalog = new SqliteSkillCatalog(dataDir, path.join(dataDir, 'index', 'search.db'));
    await catalog.upsertAuditEntry(
      AuditEntry.create({
        id: 'audit-1',
        skillId: 'catalog-skill',
        skillVersion: '1.0.0',
        action: 'publish_skill',
        actor: 'admin',
        after: { status: 'published' },
        createdAt: new Date('2026-07-02T12:00:00.000Z'),
      })
    );

    const history = await catalog.listSkillHistory('catalog-skill');

    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe('audit-1');
    expect(history[0]?.after).toEqual({ status: 'published' });
  });
});

function createJudgement(
  id: string,
  targetType: 'proposal' | 'skill' | 'file',
  targetId: string,
  overallRisk: JudgementRisk = JudgementRisk.LOW,
  model: string = 'sqlite-catalog'
) {
  return Judgement.create({
    id,
    targetType,
    targetId,
    overallRisk,
    model,
    summary: `${targetType} judgement`,
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    dimensions: {
      harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
      promptInjection: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
      dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
      policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'safe' },
    },
  });
}
