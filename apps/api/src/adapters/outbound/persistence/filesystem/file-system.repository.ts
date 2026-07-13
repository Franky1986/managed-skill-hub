import { promises as fs } from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import { SkillRepositoryPort } from '../../../../application/ports/outbound/skill-repository.port';
import { StorageError } from '../../../../domain/errors';
import { Proposal, ProposalFile } from '../../../../domain/proposal/Proposal';
import {
  Judgement,
  JudgementDimension,
  JudgementOverallRisk,
  JudgementRisk,
  NO_JUDGE_AVAILABLE_RISK,
} from '../../../../domain/judgement/Judgement';
import { Manifest } from '../../../../domain/skill/Manifest';
import { ManifestFile } from '../../../../domain/skill/ManifestFile';
import { SkillId } from '../../../../domain/skill/SkillId';
import { Skill } from '../../../../domain/skill/Skill';
import { SkillStatus } from '../../../../domain/skill/SkillStatus';
import { SkillVersion } from '../../../../domain/skill/SkillVersion';
import { SkillCatalogPort } from '../../../../application/ports/outbound/skill-catalog.port';

interface SkillManifestYaml {
  id: string;
  title: string;
  description?: string;
  version: string;
  status: string;
  category?: string;
  tags?: string[];
  groups?: string[];
  capabilities?: string[];
  useWhen?: string[];
  doNotUseWhen?: string[];
  entrypoint: string;
  files?: { path: string; role: string; mimeType?: string; sha256?: string }[];
}

interface ProposalYaml {
  id: string;
  skillId?: string;
  title: string;
  description: string;
  category?: string;
  tags?: string[];
  groups?: string[];
  capabilities?: string[];
  entrypoint?: string;
  status: string;
  submittedBy: string;
  submittedByPrincipalId?: string | null;
  submittedViaClientId?: string | null;
  createdAt: string;
  rejectionReason?: string | null;
  contentDigest?: string | null;
  files: { id: string; path: string; mimeType: string; sizeBytes: number; sha256: string | null }[];
  judgements: {
    id: string;
    targetType: 'proposal' | 'skill' | 'file';
    targetId: string;
    dimensions: Record<string, JudgementDimension>;
    overallRisk?: string;
    summary: string;
    skillPurposeSummary?: string | null;
    model: string | null;
    createdAt: string;
  }[];
}

export class FileSystemSkillRepository implements SkillRepositoryPort {
  constructor(
    private readonly dataDir: string,
    private readonly catalog?: SkillCatalogPort
  ) {}

  private skillsDir(): string {
    return path.join(this.dataDir, 'skills');
  }

  private proposalsDir(): string {
    return path.join(this.dataDir, 'proposals');
  }

  async save(skill: Skill): Promise<void> {
    const dir = path.join(this.skillsDir(), skill.id.toString());
    await fs.mkdir(dir, { recursive: true });
    for (const version of skill.getAllVersions()) {
      const vDir = path.join(dir, version.version);
      await fs.mkdir(vDir, { recursive: true });
      const manifestYaml: SkillManifestYaml = {
        id: version.manifest.id,
        title: version.manifest.title,
        description: version.manifest.description,
        version: version.manifest.version,
        status: version.manifest.status,
        category: version.manifest.category,
        tags: version.manifest.tags,
        capabilities: version.manifest.capabilities,
        useWhen: version.manifest.useWhen,
        doNotUseWhen: version.manifest.doNotUseWhen,
        entrypoint: version.manifest.entrypoint,
        files: version.manifest.files.map((f) => ({
          path: f.path,
          role: f.role,
          mimeType: f.mimeType ?? undefined,
          sha256: f.sha256 ?? undefined,
        })),
      };
      await fs.writeFile(path.join(vDir, 'skill.yaml'), yaml.dump(manifestYaml));
    }
    await this.catalog?.upsertSkill(skill);
  }

  async findById(id: string): Promise<Skill | null> {
    const dir = path.join(this.skillsDir(), id);
    try {
      const versions = await fs.readdir(dir);
      const skill = Skill.create({ id: SkillId.create(id), createdBy: 'system' });
      for (const versionDir of versions) {
        const versionPath = path.join(dir, versionDir);
        const stat = await fs.stat(versionPath);
        if (!stat.isDirectory()) continue;
        const skillVersion = await this.loadVersion(id, versionDir);
        if (skillVersion) {
          skill.addVersion(skillVersion);
        }
      }
      const published = [...skill.getPublishedVersions()].sort((left, right) =>
        compareVersions(left.version, right.version)
      );
      const latestPublished = published[published.length - 1];
      if (latestPublished) {
        skill.setLatestPublished(latestPublished.version);
      }
      return skill;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new StorageError(`Failed to load skill ${id}: ${(err as Error).message}`);
    }
  }

  async findAll(options?: { category?: string; status?: string; limit?: number; offset?: number }): Promise<{ items: Skill[]; total: number }> {
    const skills: Skill[] = [];
    try {
      const entries = await fs.readdir(this.skillsDir(), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skill = await this.findById(entry.name);
        if (!skill) continue;
        if (options?.category && skill.getLatestPublishedVersion()?.manifest.category !== options.category) continue;
        if (
          options?.status &&
          !skill.getAllVersions().some((version) => version.status === options.status)
        ) {
          continue;
        }
        skills.push(skill);
      }
    } catch {
      return { items: [], total: 0 };
    }
    const total = skills.length;
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? skills.length;
    return { items: skills.slice(offset, offset + limit), total };
  }

  async exists(id: string): Promise<boolean> {
    try {
      const stat = await fs.stat(path.join(this.skillsDir(), id));
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    const dir = path.join(this.proposalsDir(), proposal.id);
    await fs.mkdir(dir, { recursive: true });
    const yamlDoc: ProposalYaml = {
      id: proposal.id,
      skillId: proposal.skillId ?? undefined,
      title: proposal.title,
      description: proposal.description,
      category: proposal.category,
      tags: proposal.tags,
      capabilities: proposal.capabilities,
      entrypoint: proposal.entrypoint ?? undefined,
      status: proposal.status,
      submittedBy: proposal.submittedBy,
      submittedByPrincipalId: proposal.submittedByPrincipalId,
      submittedViaClientId: proposal.submittedViaClientId,
      createdAt: proposal.createdAt.toISOString(),
      rejectionReason: proposal.rejectionReason,
      contentDigest: proposal.contentDigest,
      files: proposal.files.map((f) => ({
        id: f.id,
        path: f.path,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        sha256: f.sha256,
      })),
      judgements: proposal.judgements.map((judgement) => ({
        id: judgement.id,
        targetType: judgement.targetType,
        targetId: judgement.targetId,
        dimensions: judgement.dimensions,
        overallRisk: judgement.overallRisk,
        summary: judgement.summary,
        skillPurposeSummary: judgement.skillPurposeSummary,
        model: judgement.model,
        createdAt: judgement.createdAt.toISOString(),
      })),
    };
    await fs.writeFile(path.join(dir, 'proposal.yaml'), yaml.dump(yamlDoc));
    await this.catalog?.upsertProposal(proposal);
  }

  async findProposalById(id: string): Promise<Proposal | null> {
    const file = path.join(this.proposalsDir(), id, 'proposal.yaml');
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const doc = yaml.load(raw) as ProposalYaml;
      return Proposal.rehydrate({
        id: doc.id,
        skillId: doc.skillId ?? null,
        title: doc.title,
        description: doc.description,
        category: doc.category ?? doc.groups?.[0] ?? 'uncategorized',
        tags: doc.tags ?? doc.groups?.slice(1) ?? [],
        capabilities: doc.capabilities,
        entrypoint: doc.entrypoint ?? null,
        files: (doc.files ?? []).map((f) => ProposalFile.create(f)),
        judgements: (doc.judgements ?? []).map((judgement) =>
          Judgement.create({
            id: judgement.id,
            targetType: judgement.targetType,
            targetId: judgement.targetId,
            dimensions: rehydrateDimensions(judgement.dimensions),
            overallRisk: parseJudgementOverallRisk(judgement.overallRisk, judgement.model, judgement.dimensions),
            summary: judgement.summary,
            skillPurposeSummary: judgement.skillPurposeSummary ?? null,
            model: judgement.model,
            createdAt: new Date(judgement.createdAt),
          })
        ),
        status: doc.status as Proposal['status'],
        submittedBy: doc.submittedBy,
        submittedByPrincipalId: doc.submittedByPrincipalId ?? null,
        submittedViaClientId: doc.submittedViaClientId ?? null,
        createdAt: new Date(doc.createdAt),
        rejectionReason: doc.rejectionReason ?? null,
        contentDigest: doc.contentDigest ?? null,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new StorageError(`Failed to load proposal ${id}: ${(err as Error).message}`);
    }
  }

  async findProposals(options?: { skillId?: string; status?: string }): Promise<{ items: Proposal[]; total: number }> {
    const proposals: Proposal[] = [];
    const statusFilter = normalizeStatusFilter(options?.status);
    try {
      const entries = await fs.readdir(this.proposalsDir(), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const proposal = await this.findProposalById(entry.name);
        if (!proposal) continue;
        if (options?.skillId && proposal.skillId !== options.skillId) continue;
        if (statusFilter.length > 0 && !statusFilter.includes(proposal.status)) continue;
        proposals.push(proposal);
      }
    } catch {
      return { items: [], total: 0 };
    }
    return { items: proposals, total: proposals.length };
  }

  async deleteProposal(id: string): Promise<void> {
    const dir = path.join(this.proposalsDir(), id);
    try {
      await fs.rm(dir, { recursive: true, force: true });
      await this.catalog?.deleteProposal(id);
    } catch (err) {
      throw new StorageError(`Failed to delete proposal ${id}: ${(err as Error).message}`);
    }
  }

  private async loadVersion(skillId: string, version: string): Promise<SkillVersion | null> {
    const file = path.join(this.skillsDir(), skillId, version, 'skill.yaml');
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const doc = yaml.load(raw) as SkillManifestYaml;
      const manifest = Manifest.create({
        id: doc.id,
        title: doc.title,
        description: doc.description,
        version: doc.version,
        status: doc.status as SkillStatus,
        category: doc.category ?? doc.groups?.[0] ?? 'uncategorized',
        tags: doc.tags ?? doc.groups?.slice(1) ?? [],
        capabilities: doc.capabilities,
        useWhen: doc.useWhen,
        doNotUseWhen: doc.doNotUseWhen,
        entrypoint: doc.entrypoint,
        files: doc.files?.map((f) =>
          ManifestFile.create({
            path: f.path,
            role: f.role,
            mimeType: f.mimeType ?? null,
            sha256: f.sha256 ?? null,
          })
        ),
      });
      return SkillVersion.create({
        skillId: SkillId.create(skillId),
        version: doc.version,
        manifest,
        createdBy: 'system',
      });
    } catch {
      return null;
    }
  }
}

function normalizeStatusFilter(status?: string): string[] {
  if (!status) return [];
  return status
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number(part));
  const rightParts = right.split('.').map((part) => Number(part));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function rehydrateDimensions(dimensions: Record<string, JudgementDimension>): Record<string, JudgementDimension> {
  return Object.fromEntries(
    Object.entries(dimensions).map(([key, dimension]) => [
      key,
      {
        risk: parseJudgementRisk(dimension.risk),
        score: dimension.score,
        reason: dimension.reason,
      },
    ])
  );
}

function parseJudgementRisk(risk: string): JudgementRisk {
  switch (risk) {
    case JudgementRisk.LOW:
    case JudgementRisk.MEDIUM:
    case JudgementRisk.HIGH:
    case JudgementRisk.CRITICAL:
      return risk;
    default:
      throw new StorageError(`Unknown judgement risk stored in proposal YAML: ${risk}`);
  }
}

function parseJudgementOverallRisk(
  rawRisk: string | undefined,
  model: string | null | undefined,
  dimensions: Record<string, JudgementDimension>
): JudgementOverallRisk {
  if (rawRisk === NO_JUDGE_AVAILABLE_RISK) {
    return NO_JUDGE_AVAILABLE_RISK;
  }

  if (Object.values(JudgementRisk).includes(rawRisk as JudgementRisk)) {
    return rawRisk as JudgementRisk;
  }

  if (rawRisk === undefined && model === 'noop') {
    return NO_JUDGE_AVAILABLE_RISK;
  }

  if (rawRisk === undefined) {
    return inferOverallRiskFromDimensions(reattachedRiskValues(dimensions));
  }

  if (typeof rawRisk === 'string') {
    return parseJudgementRisk(rawRisk);
  }

  return JudgementRisk.LOW;
}

function reattachedRiskValues(dimensions: Record<string, JudgementDimension>): JudgementRisk[] {
  return Object.values(dimensions)
    .map((dimension) => parseJudgementRisk(dimension.risk))
    .filter((risk): risk is JudgementRisk => risk !== null);
}

function inferOverallRiskFromDimensions(values: JudgementRisk[]): JudgementOverallRisk {
  if (values.some((value) => value === JudgementRisk.CRITICAL)) {
    return JudgementRisk.CRITICAL;
  }
  if (values.some((value) => value === JudgementRisk.HIGH)) {
    return JudgementRisk.HIGH;
  }
  if (values.some((value) => value === JudgementRisk.MEDIUM)) {
    return JudgementRisk.MEDIUM;
  }
  return JudgementRisk.LOW;
}
