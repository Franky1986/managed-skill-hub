import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import {
  CatalogAuditEntryRecord,
  CatalogJudgementRecord,
  CatalogProposalFileRecord,
  CatalogProposalRecord,
  CatalogSkillFileRecord,
  CatalogSkillRef,
  CatalogSkillVersionRecord,
  SkillCatalogPort,
} from '../../../../application/ports/outbound/skill-catalog.port';
import { Proposal } from '../../../../domain/proposal/Proposal';
import { ProposalStatus } from '../../../../domain/proposal/ProposalStatus';
import { Skill } from '../../../../domain/skill/Skill';
import { StorageError } from '../../../../domain/errors';
import {
  Judgement,
  JudgementOverallRisk,
  JudgementRisk,
  NO_JUDGE_AVAILABLE_RISK,
  JudgementTargetType,
} from '../../../../domain/judgement/Judgement';
import { AuditEntry } from '../../../../domain/audit/AuditEntry';
import { ensureSqliteCatalogSchema } from './sqlite.catalog-schema';
import {
  computeArtifactId,
  computeContentDigestForVersion,
  computeSkillUuid,
  computeVersionUuid,
  isExtractableArtifact,
} from '../../../../application/usecases/skill/public-metadata';
import { deriveProposalReviewMetadata } from '../../../../application/usecases/proposal/review-metadata';

interface FileMetaEntry {
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  updatedAt?: string;
}

export class SqliteSkillCatalog implements SkillCatalogPort {
  private db: Database.Database | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly indexPath: string
  ) {}

  async upsertSkill(skill: Skill): Promise<void> {
    const db = this.getDb();
    const versions = skill.getAllVersions();
    const publishedVersions = [...skill.getPublishedVersions()].sort((left, right) =>
      compareVersions(left.version, right.version)
    );
    const allVersions = [...versions].sort((left, right) => compareVersions(left.version, right.version));
    const latestPublishedVersion = publishedVersions[publishedVersions.length - 1]?.version ?? null;
    const latestVersion = allVersions[allVersions.length - 1]?.version ?? null;

    const versionRows = await Promise.all(
      versions.map(async (version) => ({
        skillId: skill.id.toString(),
        version: version.version,
        title: version.manifest.title,
        description: version.manifest.description,
        category: version.manifest.category,
        tags: JSON.stringify(version.manifest.tags),
        capabilities: JSON.stringify(version.manifest.capabilities),
        useWhen: JSON.stringify(version.manifest.useWhen),
        doNotUseWhen: JSON.stringify(version.manifest.doNotUseWhen),
        entrypoint: version.manifest.entrypoint,
        status: version.status,
        skillUuid: computeSkillUuid(skill.id.toString()),
        versionUuid: computeVersionUuid(skill.id.toString(), version.version),
        contentDigest: computeContentDigestForVersion(version),
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
        updatedAt: await this.resolveVersionUpdatedAt(skill.id.toString(), version.version),
        isLatestPublished: latestPublishedVersion === version.version ? 1 : 0,
        isLatestVersion: latestVersion === version.version ? 1 : 0,
      }))
    );

    const fileRows = await Promise.all(
      versions.flatMap((version) =>
        version.manifest.files.map(async (file) => {
          const meta = await this.readFileMeta(skill.id.toString(), version.version);
          const fileMeta = meta[file.path] ?? {};
          const mimeType = file.mimeType ?? fileMeta.mimeType ?? 'application/octet-stream';
          return {
            skillId: skill.id.toString(),
            version: version.version,
            path: file.path,
            artifactId: computeArtifactId(skill.id.toString(), version.version, file.path),
            role: file.role,
            mimeType,
            sizeBytes: fileMeta.sizeBytes ?? 0,
            sha256: file.sha256 ?? fileMeta.sha256 ?? null,
            updatedAt: fileMeta.updatedAt ?? null,
            extractable: isExtractableArtifact(mimeType, file.path) ? 1 : 0,
          };
        })
      )
    );

    const deleteVersions = db.prepare('DELETE FROM skill_catalog_versions WHERE skill_id = ?');
    const deleteFiles = db.prepare('DELETE FROM skill_catalog_files WHERE skill_id = ?');
    const insertVersion = db.prepare(`
      INSERT INTO skill_catalog_versions (
        skill_id, version, title, description, category, tags, capabilities, status,
        use_when, do_not_use_when, entrypoint, skill_uuid, version_uuid, content_digest, created_at, approved_by, approved_at, published_by, published_at, rejected_by, rejected_at, rejection_reason, deprecated_by, deprecated_at, deprecation_reason, updated_at, is_latest_published, is_latest_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFile = db.prepare(`
      INSERT INTO skill_catalog_files (
        skill_id, version, path, artifact_id, role, mime_type, size_bytes, sha256, updated_at, extractable
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      deleteFiles.run(skill.id.toString());
      deleteVersions.run(skill.id.toString());
      for (const row of versionRows) {
        insertVersion.run(
          row.skillId,
          row.version,
          row.title,
          row.description,
          row.category,
          row.tags,
          row.capabilities,
          row.status,
          row.useWhen,
          row.doNotUseWhen,
          row.entrypoint,
          row.skillUuid,
          row.versionUuid,
          row.contentDigest,
          row.createdAt,
          row.approvedBy,
          row.approvedAt,
          row.publishedBy,
          row.publishedAt,
          row.rejectedBy,
          row.rejectedAt,
          row.rejectionReason,
          row.deprecatedBy,
          row.deprecatedAt,
          row.deprecationReason,
          row.updatedAt,
          row.isLatestPublished,
          row.isLatestVersion
        );
      }
      for (const row of fileRows) {
        insertFile.run(
          row.skillId,
          row.version,
          row.path,
          row.artifactId,
          row.role,
          row.mimeType,
          row.sizeBytes,
          row.sha256,
          row.updatedAt,
          row.extractable
        );
      }
    });

    try {
      tx();
    } catch (error) {
      throw new StorageError(`Failed to project skill ${skill.id.toString()} into catalog: ${(error as Error).message}`);
    }
  }

  async upsertProposal(proposal: Proposal): Promise<void> {
    const db = this.getDb();
    const review = deriveProposalReviewMetadata({
      title: proposal.title,
      description: proposal.description,
      entrypoint: proposal.entrypoint,
      tags: proposal.tags,
      capabilities: proposal.capabilities,
      judgements: proposal.judgements,
      files: proposal.files.map((file) => ({ path: file.path, mimeType: file.mimeType })),
    });
    const upsertProposal = db.prepare(`
      INSERT OR REPLACE INTO skill_catalog_proposals (
        id, skill_id, title, description, category, tags, capabilities, entrypoint,
        status, submitted_by, submitted_by_principal_id, submitted_via_client_id,
        created_at, rejection_reason, latest_judgement_risk, review_labels,
        latest_judgement_id, latest_judged_at, content_digest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteFiles = db.prepare('DELETE FROM skill_catalog_proposal_files WHERE proposal_id = ?');
    const insertFile = db.prepare(`
      INSERT INTO skill_catalog_proposal_files (
        proposal_id, id, path, mime_type, size_bytes, sha256
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const deleteJudgements = db.prepare('DELETE FROM skill_catalog_judgements WHERE proposal_id = ?');
    const insertJudgement = db.prepare(`
      INSERT INTO skill_catalog_judgements (
        id, target_type, target_id, proposal_id, skill_id, skill_version,
        dimensions, overall_risk, summary, skill_purpose_summary, model, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      upsertProposal.run(
        proposal.id,
        proposal.skillId,
        proposal.title,
        proposal.description,
        proposal.category,
        JSON.stringify(proposal.tags),
        JSON.stringify(proposal.capabilities),
        proposal.entrypoint,
        proposal.status,
        proposal.submittedBy,
        proposal.submittedByPrincipalId,
        proposal.submittedViaClientId,
        proposal.createdAt.toISOString(),
        proposal.rejectionReason,
        review.latestJudgementRisk,
        JSON.stringify(review.labels),
        review.latestJudgementId,
        review.latestJudgedAt?.toISOString() ?? null,
        proposal.contentDigest
      );
      deleteFiles.run(proposal.id);
      for (const file of proposal.files) {
        insertFile.run(
          proposal.id,
          file.id,
          file.path,
          file.mimeType,
          file.sizeBytes,
          file.sha256
        );
      }
      deleteJudgements.run(proposal.id);
      for (const judgement of proposal.judgements) {
        insertJudgement.run(
          judgement.id,
          judgement.targetType,
          judgement.targetId,
          proposal.id,
          proposal.skillId,
          null,
          JSON.stringify(judgement.dimensions),
          judgement.overallRisk,
          judgement.summary,
          judgement.skillPurposeSummary,
          judgement.model,
          judgement.createdAt.toISOString()
        );
      }
    });

    try {
      tx();
    } catch (error) {
      throw new StorageError(`Failed to project proposal ${proposal.id} judgements into catalog: ${(error as Error).message}`);
    }
  }

  async deleteProposal(proposalId: string): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare('DELETE FROM skill_catalog_proposals WHERE id = ?').run(proposalId);
      db.prepare('DELETE FROM skill_catalog_proposal_files WHERE proposal_id = ?').run(proposalId);
      db.prepare('DELETE FROM skill_catalog_judgements WHERE proposal_id = ?').run(proposalId);
    } catch (error) {
      throw new StorageError(`Failed to delete proposal ${proposalId} judgements from catalog: ${(error as Error).message}`);
    }
  }

  async upsertSkillJudgement(skillId: string, version: string, judgement: Judgement): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare(
        `INSERT OR REPLACE INTO skill_catalog_judgements (
          id, target_type, target_id, proposal_id, skill_id, skill_version,
          dimensions, overall_risk, summary, skill_purpose_summary, model, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        judgement.id,
        judgement.targetType,
        judgement.targetId,
        null,
        skillId,
        version,
        JSON.stringify(judgement.dimensions),
        judgement.overallRisk,
        judgement.summary,
        judgement.skillPurposeSummary,
        judgement.model,
        judgement.createdAt.toISOString()
      );
    } catch (error) {
      throw new StorageError(`Failed to project skill judgement ${judgement.id} into catalog: ${(error as Error).message}`);
    }
  }

  async listJudgements(targetType: JudgementTargetType, targetId: string): Promise<CatalogJudgementRecord[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT *
         FROM skill_catalog_judgements
         WHERE target_type = ? AND target_id = ?
         ORDER BY created_at`
      )
      .all(targetType, targetId) as CatalogJudgementRow[];
    return rows.map(mapCatalogJudgementRow);
  }

  async upsertAuditEntry(entry: AuditEntry): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare(
        `INSERT OR REPLACE INTO skill_catalog_audit_entries (
          id, skill_id, skill_version, proposal_id, action, actor,
          actor_principal_id, actor_display_name, actor_client_id,
          before_json, after_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        entry.id,
        entry.skillId,
        entry.skillVersion,
        entry.proposalId,
        entry.action,
        entry.actor,
        entry.actorPrincipalId,
        entry.actorDisplayName,
        entry.actorClientId,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after ? JSON.stringify(entry.after) : null,
        entry.createdAt.toISOString()
      );
    } catch (error) {
      throw new StorageError(`Failed to project audit entry ${entry.id} into catalog: ${(error as Error).message}`);
    }
  }

  async listSkillHistory(skillId: string): Promise<CatalogAuditEntryRecord[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT *
         FROM skill_catalog_audit_entries
         WHERE skill_id = ?
         ORDER BY created_at`
      )
      .all(skillId) as CatalogAuditEntryRow[];
    return rows.map(mapCatalogAuditEntryRow);
  }

  async listProposals(options?: {
    skillId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: CatalogProposalRecord[]; total: number }> {
    const db = this.getDb();
    const statuses = normalizeStatusFilter(options?.status);
    const whereParts: string[] = [];
    const params: Array<string | number> = [];
    if (options?.skillId) {
      whereParts.push('skill_id = ?');
      params.push(options.skillId);
    }
    if (statuses.length === 1) {
      whereParts.push('status = ?');
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      whereParts.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const total = (
      db.prepare(`SELECT COUNT(*) as count FROM skill_catalog_proposals ${where}`).get(...params) as { count: number }
    ).count;
    const limit = options?.limit ?? 200;
    const offset = options?.offset ?? 0;
    const rows = db
      .prepare(
        `${buildProposalSelect()}
         ${where}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as CatalogProposalRow[];

    return {
      items: rows.map(mapCatalogProposalRow),
      total,
    };
  }

  async listLatestSkillVersions(options?: {
    category?: string;
    publishedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: CatalogSkillVersionRecord[]; total: number }> {
    const db = this.getDb();
    const publishedOnly = options?.publishedOnly ?? false;
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const whereParts: string[] = [];
    const params: Array<string | number> = [];

    if (publishedOnly) {
      whereParts.push("status = 'published'");
      whereParts.push('is_latest_published = 1');
    } else {
      whereParts.push('is_latest_version = 1');
    }

    if (options?.category) {
      whereParts.push('category = ?');
      params.push(options.category);
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const total = (
      db.prepare(`SELECT COUNT(*) as count FROM skill_catalog_versions ${where}`).get(...params) as { count: number }
    ).count;
    const rows = db
      .prepare(
        `SELECT *
         FROM skill_catalog_versions
         ${where}
         ORDER BY skill_id
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as CatalogVersionRow[];
    return {
      items: rows.map(mapCatalogVersionRow),
      total,
    };
  }

  async getProposal(proposalId: string): Promise<CatalogProposalRecord | null> {
    const db = this.getDb();
    const row = db
      .prepare(
        `${buildProposalSelect()}
         WHERE id = ?
         LIMIT 1`
      )
      .get(proposalId) as CatalogProposalRow | undefined;
    return row ? mapCatalogProposalRow(row) : null;
  }

  async findProposalByContentDigest(contentDigest: string, excludeId?: string): Promise<CatalogProposalRecord | null> {
    const db = this.getDb();
    const query = excludeId
      ? `${buildProposalSelect()}
         WHERE content_digest = ? AND id != ? AND status IN ('submitted', 'judged')
         ORDER BY created_at DESC
         LIMIT 1`
      : `${buildProposalSelect()}
         WHERE content_digest = ? AND status IN ('submitted', 'judged')
         ORDER BY created_at DESC
         LIMIT 1`;
    const params = excludeId ? [contentDigest, excludeId] : [contentDigest];
    const row = db.prepare(query).get(...params) as CatalogProposalRow | undefined;
    return row ? mapCatalogProposalRow(row) : null;
  }

  async findPublishedSkillByContentDigest(contentDigest: string): Promise<{ skillId: string; version: string } | null> {
    const db = this.getDb();
    const row = db
      .prepare(
        `SELECT skill_id, version
         FROM skill_catalog_versions
         WHERE content_digest = ? AND status = 'published'
         LIMIT 1`
      )
      .get(contentDigest) as { skill_id: string; version: string } | undefined;
    return row ? { skillId: row.skill_id, version: row.version } : null;
  }

  async listProposalFiles(proposalId: string): Promise<CatalogProposalFileRecord[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT *
         FROM skill_catalog_proposal_files
         WHERE proposal_id = ?
         ORDER BY path`
      )
      .all(proposalId) as CatalogProposalFileRow[];
    return rows.map(mapCatalogProposalFileRow);
  }

  async listProposalJudgements(proposalId: string): Promise<CatalogJudgementRecord[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT *
         FROM skill_catalog_judgements
         WHERE proposal_id = ?
         ORDER BY created_at`
      )
      .all(proposalId) as CatalogJudgementRow[];
    return rows.map(mapCatalogJudgementRow);
  }

  async countPendingProposals(): Promise<number> {
    const db = this.getDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM skill_catalog_proposals
         WHERE status IN (?, ?)`
      )
      .get(ProposalStatus.SUBMITTED, ProposalStatus.JUDGED) as { count: number };
    return row.count;
  }

  async countProposalsByStatus(): Promise<Record<ProposalStatus, number>> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT status, COUNT(*) as count
         FROM skill_catalog_proposals
         GROUP BY status`
      )
      .all() as Array<{ status: string; count: number }>;
    const result = {} as Record<ProposalStatus, number>;
    for (const status of Object.values(ProposalStatus)) {
      result[status] = 0;
    }
    for (const row of rows) {
      if (row.status in result) {
        result[row.status as ProposalStatus] = row.count;
      }
    }
    return result;
  }

  async rebuild(skills: Skill[], options?: { clearProjections?: boolean }): Promise<void> {
    const clearProjections = options?.clearProjections ?? false;
    const db = this.getDb();
    if (clearProjections) {
      db.exec(`
        DELETE FROM skill_catalog_audit_entries;
        DELETE FROM skill_catalog_judgements;
        DELETE FROM skill_catalog_proposal_files;
        DELETE FROM skill_catalog_proposals;
        DELETE FROM skill_catalog_files;
        DELETE FROM skill_catalog_versions;
      `);
    }

    db.exec(`
      DELETE FROM skill_catalog_files;
      DELETE FROM skill_catalog_versions;
    `);

    for (const skill of skills) {
      await this.upsertSkill(skill);
    }
  }

  async listCategories(): Promise<string[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT category
         FROM skill_catalog_versions
         WHERE status = 'published'
         ORDER BY category`
      )
      .all() as Array<{ category: string }>;
    return rows.map((row) => row.category);
  }

  async listTags(): Promise<string[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT json_each.value as tag
         FROM skill_catalog_versions, json_each(skill_catalog_versions.tags)
         WHERE status = 'published' AND is_latest_published = 1
         ORDER BY tag`
      )
      .all() as Array<{ tag: string }>;
    return rows.map((row) => row.tag).filter(Boolean);
  }

  async listPublishedSkillRefs(
    category?: string,
    limit = 50,
    offset = 0
  ): Promise<{ items: CatalogSkillRef[]; total: number }> {
    const db = this.getDb();
    const where = category
      ? `WHERE status = 'published' AND is_latest_published = 1 AND category = ?`
      : `WHERE status = 'published' AND is_latest_published = 1`;
    const params = category ? [category] : [];
    const total = (
      db.prepare(`SELECT COUNT(*) as count FROM skill_catalog_versions ${where}`).get(...params) as {
        count: number;
      }
    ).count;
    const rows = db
      .prepare(
        `SELECT skill_id, version
         FROM skill_catalog_versions
         ${where}
         ORDER BY skill_id
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Array<{ skill_id: string; version: string }>;
    return {
      items: rows.map((row) => ({ skillId: row.skill_id, version: row.version })),
      total,
    };
  }

  async getLatestPublishedVersion(skillId: string): Promise<CatalogSkillVersionRecord | null> {
    const db = this.getDb();
    const row = db
      .prepare(
        `SELECT *
         FROM skill_catalog_versions
         WHERE skill_id = ? AND status = 'published' AND is_latest_published = 1
         LIMIT 1`
      )
      .get(skillId) as CatalogVersionRow | undefined;
    return row ? mapCatalogVersionRow(row) : null;
  }

  async getSkillVersion(skillId: string, version: string): Promise<CatalogSkillVersionRecord | null> {
    const db = this.getDb();
    const row = db
      .prepare(
        `SELECT *
         FROM skill_catalog_versions
         WHERE skill_id = ? AND version = ?
         LIMIT 1`
      )
      .get(skillId, version) as CatalogVersionRow | undefined;
    return row ? mapCatalogVersionRow(row) : null;
  }

  async getLatestVersion(skillId: string): Promise<CatalogSkillVersionRecord | null> {
    const db = this.getDb();
    const row = db
      .prepare(
        `SELECT *
         FROM skill_catalog_versions
         WHERE skill_id = ? AND is_latest_version = 1
         LIMIT 1`
      )
      .get(skillId) as CatalogVersionRow | undefined;
    return row ? mapCatalogVersionRow(row) : null;
  }

  async listSkillVersions(skillId: string, options?: { publishedOnly?: boolean }): Promise<CatalogSkillVersionRecord[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT *
         FROM skill_catalog_versions
         WHERE skill_id = ? ${options?.publishedOnly ? `AND status = 'published'` : ''}
         ORDER BY created_at, version`
      )
      .all(skillId) as CatalogVersionRow[];
    return rows.map(mapCatalogVersionRow);
  }

  async listPublishedVersions(skillId: string): Promise<CatalogSkillVersionRecord[]> {
    return this.listSkillVersions(skillId, { publishedOnly: true });
  }

  async listVersionFiles(skillId: string, version: string): Promise<CatalogSkillFileRecord[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT *
         FROM skill_catalog_files
         WHERE skill_id = ? AND version = ?
         ORDER BY path`
      )
      .all(skillId, version) as CatalogFileRow[];
    return rows.map((row) => ({
      skillId: row.skill_id,
      version: row.version,
      path: row.path,
      artifactId: row.artifact_id,
      role: row.role,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
      extractable: row.extractable === 1,
    }));
  }

  private getDb(): Database.Database {
    if (!this.db) {
      mkdirSync(path.dirname(this.indexPath), { recursive: true });
      this.db = new Database(this.indexPath);
      ensureSqliteCatalogSchema(this.db);
    }
    return this.db;
  }

  private async readFileMeta(skillId: string, version: string): Promise<Record<string, FileMetaEntry>> {
    const dbMeta = this.readDatabaseFileMeta(skillId, version);
    if (Object.keys(dbMeta).length > 0) {
      return dbMeta;
    }

    const metaPath = path.join(this.dataDir, 'skills', skillId, version, '.meta.json');
    try {
      const raw = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(raw) as Record<string, FileMetaEntry>;
    } catch {
      return {};
    }
  }

  private readDatabaseFileMeta(skillId: string, version: string): Record<string, FileMetaEntry> {
    try {
      const rows = this.getDb().prepare(`
        SELECT path, mime_type, size_bytes, sha256, updated_at
        FROM content_skill_files
        WHERE skill_id = ? AND version = ?
      `).all(skillId, version) as Array<{
        path: string;
        mime_type: string;
        size_bytes: number;
        sha256: string | null;
        updated_at: string | null;
      }>;
      return Object.fromEntries(rows.map((row) => [row.path, {
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        sha256: row.sha256 ?? undefined,
        updatedAt: row.updated_at ?? undefined,
      }]));
    } catch {
      return {};
    }
  }

  private async resolveVersionUpdatedAt(skillId: string, version: string): Promise<string | null> {
    const meta = await this.readFileMeta(skillId, version);
    const timestamps = Object.values(meta)
      .map((entry) => entry.updatedAt ?? null)
      .filter((value): value is string => Boolean(value))
      .sort();
    return timestamps[timestamps.length - 1] ?? null;
  }

}

function normalizeStatusFilter(status?: string): string[] {
  if (!status) return [];
  return status
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function buildProposalSelect(): string {
  return `
    SELECT
      p.*,
      (
        SELECT j.overall_risk
        FROM skill_catalog_judgements j
        WHERE j.id = p.latest_judgement_id
        LIMIT 1
      ) AS latest_judgement_overall_risk,
      (
        SELECT j.model
        FROM skill_catalog_judgements j
        WHERE j.id = p.latest_judgement_id
        LIMIT 1
      ) AS latest_judgement_model
    FROM skill_catalog_proposals p
  `;
}

function normalizeJudgementOverallRisk(
  rawRisk: string | null,
  model: string | null,
  dimensions: Record<string, { risk: string }>
): JudgementOverallRisk {
  const normalizedRawRisk = rawRisk ?? parseRiskFromDimensions(dimensions);
  if (normalizedRawRisk === NO_JUDGE_AVAILABLE_RISK) {
    return NO_JUDGE_AVAILABLE_RISK;
  }

  if (model === 'noop') {
    return NO_JUDGE_AVAILABLE_RISK;
  }

  if (
    normalizedRawRisk === JudgementRisk.LOW ||
    normalizedRawRisk === JudgementRisk.MEDIUM ||
    normalizedRawRisk === JudgementRisk.HIGH ||
    normalizedRawRisk === JudgementRisk.CRITICAL
  ) {
    return normalizedRawRisk;
  }

  return JudgementRisk.LOW;
}

function parseRiskFromDimensions(dimensions: Record<string, { risk: string }>): JudgementOverallRisk {
  const values = Object.values(dimensions)
    .map((dimension) => dimension.risk)
    .filter((risk): risk is string => typeof risk === 'string');
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

function resolveLatestProposalJudgementRisk(
  latestJudgementRisk: string | null,
  latestJudgementOverallRisk: string | null,
  latestJudgementModel: string | null,
  latestJudgementId: string | null
): JudgementOverallRisk | null {
  if (latestJudgementId === null) {
    return null;
  }

  const effectiveRisk = latestJudgementOverallRisk ?? latestJudgementRisk;
  return normalizeJudgementOverallRisk(effectiveRisk, latestJudgementModel, {});
}

interface CatalogVersionRow {
  skill_id: string;
  version: string;
  title: string;
  description: string;
  category: string;
  tags: string;
  capabilities: string;
  use_when: string;
  do_not_use_when: string;
  entrypoint: string;
  status: string;
  skill_uuid: string;
  version_uuid: string;
  content_digest: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  published_by: string | null;
  published_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  deprecated_by: string | null;
  deprecated_at: string | null;
  deprecation_reason: string | null;
  updated_at: string | null;
  is_latest_published: number;
  is_latest_version: number;
}

interface CatalogFileRow {
  skill_id: string;
  version: string;
  path: string;
  artifact_id: string;
  role: string;
  mime_type: string;
  size_bytes: number;
  sha256: string | null;
  updated_at: string | null;
  extractable: number;
}

interface CatalogJudgementRow {
  id: string;
  target_type: JudgementTargetType;
  target_id: string;
  proposal_id: string | null;
  skill_id: string | null;
  skill_version: string | null;
  dimensions: string;
  overall_risk: string | null;
  summary: string;
  skill_purpose_summary: string | null;
  model: string | null;
  created_at: string;
}

interface CatalogAuditEntryRow {
  id: string;
  skill_id: string | null;
  skill_version: string | null;
  proposal_id: string | null;
  action: string;
  actor: string;
  actor_principal_id: string | null;
  actor_display_name: string | null;
  actor_client_id: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

interface CatalogProposalRow {
  id: string;
  skill_id: string | null;
  title: string;
  description: string;
  category: string;
  tags: string;
  capabilities: string;
  entrypoint: string | null;
  status: string;
  submitted_by: string;
  submitted_by_principal_id: string | null;
  submitted_via_client_id: string | null;
  created_at: string;
  rejection_reason: string | null;
  latest_judgement_risk: string | null;
  latest_judgement_overall_risk: string | null;
  latest_judgement_model: string | null;
  review_labels: string;
  latest_judgement_id: string | null;
  latest_judged_at: string | null;
  content_digest: string | null;
}

interface CatalogProposalFileRow {
  proposal_id: string;
  id: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string | null;
}

function mapCatalogVersionRow(row: CatalogVersionRow): CatalogSkillVersionRecord {
  return {
    skillId: row.skill_id,
    version: row.version,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: JSON.parse(row.tags) as string[],
    capabilities: JSON.parse(row.capabilities) as string[],
    useWhen: JSON.parse(row.use_when) as string[],
    doNotUseWhen: JSON.parse(row.do_not_use_when) as string[],
    entrypoint: row.entrypoint,
    status: row.status,
    skillUuid: row.skill_uuid,
    versionUuid: row.version_uuid,
    contentDigest: row.content_digest,
    createdAt: new Date(row.created_at),
    approvedBy: row.approved_by,
    approvedAt: row.approved_at ? new Date(row.approved_at) : null,
    publishedBy: row.published_by,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at) : null,
    rejectionReason: row.rejection_reason,
    deprecatedBy: row.deprecated_by,
    deprecatedAt: row.deprecated_at ? new Date(row.deprecated_at) : null,
    deprecationReason: row.deprecation_reason,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    isLatestPublished: row.is_latest_published === 1,
    isLatestVersion: row.is_latest_version === 1,
  };
}

function mapCatalogJudgementRow(row: CatalogJudgementRow): CatalogJudgementRecord {
  const dimensions = JSON.parse(row.dimensions) as CatalogJudgementRecord['dimensions'];
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    proposalId: row.proposal_id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    dimensions,
    overallRisk: normalizeJudgementOverallRisk(
      row.overall_risk,
      row.model,
      dimensions
    ),
    summary: row.summary,
    skillPurposeSummary: row.skill_purpose_summary,
    model: row.model,
    createdAt: new Date(row.created_at),
  };
}

function mapCatalogAuditEntryRow(row: CatalogAuditEntryRow): CatalogAuditEntryRecord {
  return {
    id: row.id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    proposalId: row.proposal_id,
    action: row.action,
    actor: row.actor,
    actorPrincipalId: row.actor_principal_id ?? null,
    actorDisplayName: row.actor_display_name ?? null,
    actorClientId: row.actor_client_id ?? null,
    before: row.before_json ? (JSON.parse(row.before_json) as Record<string, unknown>) : null,
    after: row.after_json ? (JSON.parse(row.after_json) as Record<string, unknown>) : null,
    createdAt: new Date(row.created_at),
  };
}

function mapCatalogProposalRow(row: CatalogProposalRow): CatalogProposalRecord {
  return {
    id: row.id,
    skillId: row.skill_id,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: JSON.parse(row.tags) as string[],
    capabilities: JSON.parse(row.capabilities) as string[],
    entrypoint: row.entrypoint,
    status: row.status as ProposalStatus,
    submittedBy: row.submitted_by,
    submittedByPrincipalId: row.submitted_by_principal_id,
    submittedViaClientId: row.submitted_via_client_id,
    createdAt: new Date(row.created_at),
    rejectionReason: row.rejection_reason,
    latestJudgementRisk: resolveLatestProposalJudgementRisk(
      row.latest_judgement_risk,
      row.latest_judgement_overall_risk,
      row.latest_judgement_model,
      row.latest_judgement_id
    ),
    labels: JSON.parse(row.review_labels) as CatalogProposalRecord['labels'],
    latestJudgementId: row.latest_judgement_id,
    latestJudgedAt: row.latest_judged_at ? new Date(row.latest_judged_at) : null,
    contentDigest: row.content_digest,
  };
}

function mapCatalogProposalFileRow(row: CatalogProposalFileRow): CatalogProposalFileRecord {
  return {
    proposalId: row.proposal_id,
    id: row.id,
    path: row.path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
  };
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
