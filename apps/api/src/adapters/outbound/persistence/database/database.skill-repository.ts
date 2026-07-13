import { StorageError } from '../../../../domain/errors';
import { Proposal, ProposalFile } from '../../../../domain/proposal/Proposal';
import { ProposalStatus } from '../../../../domain/proposal/ProposalStatus';
import { Judgement, JudgementDimension, JudgementOverallRisk, JudgementTargetType } from '../../../../domain/judgement/Judgement';
import { SkillRepositoryPort } from '../../../../application/ports/outbound/skill-repository.port';
import { SkillCatalogPort } from '../../../../application/ports/outbound/skill-catalog.port';
import { Manifest } from '../../../../domain/skill/Manifest';
import { ManifestFile } from '../../../../domain/skill/ManifestFile';
import { Skill } from '../../../../domain/skill/Skill';
import { SkillId } from '../../../../domain/skill/SkillId';
import { SkillStatus } from '../../../../domain/skill/SkillStatus';
import { SkillVersion } from '../../../../domain/skill/SkillVersion';
import { ContentDb, upsertClause } from './content-db';

interface SkillAggregateRow {
  skill_id: string;
  aggregate_json: string;
}

interface ProposalAggregateRow {
  proposal_id: string;
  aggregate_json: string;
}

interface SerializedSkill {
  id: string;
  createdBy: string;
  createdAt: string;
  latestPublishedVersion: string | null;
  versions: SerializedSkillVersion[];
}

interface SerializedSkillVersion {
  skillId: string;
  version: string;
  manifest: SerializedManifest;
  contentHash: string | null;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  deprecatedBy: string | null;
  deprecatedAt: string | null;
  deprecationReason: string | null;
}

interface SerializedManifest {
  id: string;
  title: string;
  description: string;
  version: string;
  status: SkillStatus;
  category: string;
  tags: string[];
  capabilities: string[];
  useWhen: string[];
  doNotUseWhen: string[];
  entrypoint: string;
  files: Array<{ path: string; role: string; mimeType: string | null; sha256: string | null }>;
}

interface SerializedProposal {
  id: string;
  skillId: string | null;
  title: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  entrypoint: string | null;
  status: ProposalStatus;
  submittedBy: string;
  createdAt: string;
  rejectionReason: string | null;
  contentDigest: string | null;
  files: Array<{ id: string; path: string; mimeType: string; sizeBytes: number; sha256: string | null }>;
  judgements: SerializedJudgement[];
}

interface SerializedJudgement {
  id: string;
  targetType: JudgementTargetType;
  targetId: string;
  dimensions: Record<string, JudgementDimension>;
  overallRisk: JudgementOverallRisk;
  summary: string;
  skillPurposeSummary: string | null;
  model: string | null;
  createdAt: string;
}

export class DatabaseSkillRepository implements SkillRepositoryPort {
  constructor(
    private readonly contentDb: ContentDb,
    private readonly catalog?: SkillCatalogPort
  ) {}

  async save(skill: Skill): Promise<void> {
    const payload = serializeSkill(skill);
    try {
      await this.contentDb.execute(`
        INSERT INTO content_skill_aggregates (skill_id, aggregate_json, updated_at)
        VALUES (?, ?, ?)
        ${upsertClause(this.contentDb.dialect, ['skill_id'], ['aggregate_json', 'updated_at'])}
      `, [skill.id.toString(), JSON.stringify(payload), new Date().toISOString()]);
      await this.catalog?.upsertSkill(skill);
    } catch (err) {
      throw new StorageError('Failed to save skill aggregate in database: ' + (err as Error).message);
    }
  }

  async findById(id: string): Promise<Skill | null> {
    try {
      const row = await this.contentDb.queryOne<SkillAggregateRow>(`
        SELECT skill_id, aggregate_json FROM content_skill_aggregates WHERE skill_id = ?
      `, [id]);
      return row ? deserializeSkill(parseJson(row.aggregate_json) as SerializedSkill) : null;
    } catch (err) {
      throw new StorageError('Failed to load skill aggregate from database: ' + (err as Error).message);
    }
  }

  async findAll(options?: { category?: string; status?: string; limit?: number; offset?: number }): Promise<{ items: Skill[]; total: number }> {
    try {
      const rows = await this.contentDb.queryAll<SkillAggregateRow>(`
        SELECT skill_id, aggregate_json FROM content_skill_aggregates ORDER BY skill_id
      `);
      let items = rows.map((row) => deserializeSkill(parseJson(row.aggregate_json) as SerializedSkill));
      if (options?.category) {
        items = items.filter((skill) => skill.getLatestPublishedVersion()?.manifest.category === options.category);
      }
      if (options?.status) {
        const statuses = options.status.split(',').map((entry) => entry.trim()).filter(Boolean);
        items = items.filter((skill) => skill.getAllVersions().some((version) => statuses.includes(version.status)));
      }
      const total = items.length;
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? items.length;
      return { items: items.slice(offset, offset + limit), total };
    } catch (err) {
      throw new StorageError('Failed to list skill aggregates from database: ' + (err as Error).message);
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const row = await this.contentDb.queryOne<{ found: number }>(`
        SELECT 1 AS found FROM content_skill_aggregates WHERE skill_id = ?
      `, [id]);
      return Boolean(row);
    } catch (err) {
      throw new StorageError('Failed to check skill aggregate existence in database: ' + (err as Error).message);
    }
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    const payload = serializeProposal(proposal);
    try {
      await this.contentDb.execute(`
        INSERT INTO content_proposal_aggregates (proposal_id, aggregate_json, updated_at)
        VALUES (?, ?, ?)
        ${upsertClause(this.contentDb.dialect, ['proposal_id'], ['aggregate_json', 'updated_at'])}
      `, [proposal.id, JSON.stringify(payload), new Date().toISOString()]);
      await this.catalog?.upsertProposal(proposal);
    } catch (err) {
      throw new StorageError('Failed to save proposal aggregate in database: ' + (err as Error).message);
    }
  }

  async findProposalById(id: string): Promise<Proposal | null> {
    try {
      const row = await this.contentDb.queryOne<ProposalAggregateRow>(`
        SELECT proposal_id, aggregate_json FROM content_proposal_aggregates WHERE proposal_id = ?
      `, [id]);
      return row ? deserializeProposal(parseJson(row.aggregate_json) as SerializedProposal) : null;
    } catch (err) {
      throw new StorageError('Failed to load proposal aggregate from database: ' + (err as Error).message);
    }
  }

  async findProposals(options?: { skillId?: string; status?: string }): Promise<{ items: Proposal[]; total: number }> {
    try {
      const rows = await this.contentDb.queryAll<ProposalAggregateRow>(`
        SELECT proposal_id, aggregate_json FROM content_proposal_aggregates ORDER BY proposal_id
      `);
      let items = rows.map((row) => deserializeProposal(parseJson(row.aggregate_json) as SerializedProposal));
      if (options?.skillId) {
        items = items.filter((proposal) => proposal.skillId === options.skillId);
      }
      if (options?.status) {
        const statuses = options.status.split(',').map((entry) => entry.trim()).filter(Boolean);
        items = items.filter((proposal) => statuses.includes(proposal.status));
      }
      return { items, total: items.length };
    } catch (err) {
      throw new StorageError('Failed to list proposal aggregates from database: ' + (err as Error).message);
    }
  }

  async deleteProposal(id: string): Promise<void> {
    try {
      await this.contentDb.transaction(async () => {
        await this.contentDb.execute('DELETE FROM content_proposal_aggregates WHERE proposal_id = ?', [id]);
        await this.contentDb.execute('DELETE FROM content_proposal_files WHERE proposal_id = ?', [id]);
        await this.contentDb.execute('DELETE FROM content_proposal_file_extracts WHERE proposal_id = ?', [id]);
      });
      await this.catalog?.deleteProposal(id);
    } catch (err) {
      throw new StorageError('Failed to delete proposal aggregate from database: ' + (err as Error).message);
    }
  }
}

function serializeSkill(skill: Skill): SerializedSkill {
  return {
    id: skill.id.toString(),
    createdBy: skill.createdBy,
    createdAt: skill.createdAt.toISOString(),
    latestPublishedVersion: skill.getLatestPublishedVersion()?.version ?? null,
    versions: skill.getAllVersions().map(serializeSkillVersion),
  };
}

function serializeSkillVersion(version: SkillVersion): SerializedSkillVersion {
  return {
    skillId: version.skillId.toString(),
    version: version.version,
    manifest: {
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
      files: version.manifest.files.map((file) => ({
        path: file.path,
        role: file.role,
        mimeType: file.mimeType,
        sha256: file.sha256,
      })),
    },
    contentHash: version.contentHash,
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt?.toISOString() ?? null,
    publishedBy: version.publishedBy,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    rejectedBy: version.rejectedBy,
    rejectedAt: version.rejectedAt?.toISOString() ?? null,
    rejectionReason: version.rejectionReason,
    deprecatedBy: version.deprecatedBy,
    deprecatedAt: version.deprecatedAt?.toISOString() ?? null,
    deprecationReason: version.deprecationReason,
  };
}

function deserializeSkill(payload: SerializedSkill): Skill {
  const versions = payload.versions.map(deserializeSkillVersion);
  return Skill.rehydrate({
    id: SkillId.create(payload.id),
    versions,
    latestPublishedVersion: payload.latestPublishedVersion,
    createdBy: payload.createdBy,
    createdAt: new Date(payload.createdAt),
  });
}

function deserializeSkillVersion(payload: SerializedSkillVersion): SkillVersion {
  const manifest = Manifest.create({
    id: payload.manifest.id,
    title: payload.manifest.title,
    description: payload.manifest.description,
    version: payload.manifest.version,
    status: payload.manifest.status,
    category: payload.manifest.category,
    tags: payload.manifest.tags,
    capabilities: payload.manifest.capabilities,
    useWhen: payload.manifest.useWhen,
    doNotUseWhen: payload.manifest.doNotUseWhen,
    entrypoint: payload.manifest.entrypoint,
    files: payload.manifest.files.map((file) => ManifestFile.create(file)),
  });
  return SkillVersion.rehydrate({
    skillId: SkillId.create(payload.skillId),
    version: payload.version,
    manifest,
    contentHash: payload.contentHash,
    createdBy: payload.createdBy,
    createdAt: new Date(payload.createdAt),
    approvedBy: payload.approvedBy,
    approvedAt: payload.approvedAt ? new Date(payload.approvedAt) : null,
    publishedBy: payload.publishedBy,
    publishedAt: payload.publishedAt ? new Date(payload.publishedAt) : null,
    rejectedBy: payload.rejectedBy,
    rejectedAt: payload.rejectedAt ? new Date(payload.rejectedAt) : null,
    rejectionReason: payload.rejectionReason,
    deprecatedBy: payload.deprecatedBy,
    deprecatedAt: payload.deprecatedAt ? new Date(payload.deprecatedAt) : null,
    deprecationReason: payload.deprecationReason,
  });
}

function serializeProposal(proposal: Proposal): SerializedProposal {
  return {
    id: proposal.id,
    skillId: proposal.skillId,
    title: proposal.title,
    description: proposal.description,
    category: proposal.category,
    tags: proposal.tags,
    capabilities: proposal.capabilities,
    entrypoint: proposal.entrypoint,
    status: proposal.status,
    submittedBy: proposal.submittedBy,
    createdAt: proposal.createdAt.toISOString(),
    rejectionReason: proposal.rejectionReason,
    contentDigest: proposal.contentDigest,
    files: proposal.files.map((file) => ({
      id: file.id,
      path: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
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
}

function deserializeProposal(payload: SerializedProposal): Proposal {
  return Proposal.rehydrate({
    id: payload.id,
    skillId: payload.skillId,
    title: payload.title,
    description: payload.description,
    category: payload.category,
    tags: payload.tags,
    capabilities: payload.capabilities,
    entrypoint: payload.entrypoint,
    status: payload.status,
    submittedBy: payload.submittedBy,
    createdAt: new Date(payload.createdAt),
    rejectionReason: payload.rejectionReason,
    contentDigest: payload.contentDigest,
    files: payload.files.map((file) => ProposalFile.create(file)),
    judgements: payload.judgements.map((judgement) => Judgement.create({
      id: judgement.id,
      targetType: judgement.targetType,
      targetId: judgement.targetId,
      dimensions: judgement.dimensions,
      overallRisk: judgement.overallRisk,
      summary: judgement.summary,
      skillPurposeSummary: judgement.skillPurposeSummary,
      model: judgement.model,
      createdAt: new Date(judgement.createdAt),
    })),
  });
}

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}
