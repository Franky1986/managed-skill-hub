import { promises as fs } from 'fs';
import path from 'path';
import { Judgement, JudgementOverallRisk, JudgementRisk, JudgementTargetType, NO_JUDGE_AVAILABLE_RISK } from '../../../../domain/judgement/Judgement';
import { AuditEntry } from '../../../../domain/audit/AuditEntry';
import { Proposal } from '../../../../domain/proposal/Proposal';
import { ProposalStatus } from '../../../../domain/proposal/ProposalStatus';
import { Skill } from '../../../../domain/skill/Skill';
import { StorageError } from '../../../../domain/errors';
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
import { computeArtifactId, computeContentDigestForVersion, computeSkillUuid, computeVersionUuid, isExtractableArtifact } from '../../../../application/usecases/skill/public-metadata';
import { deriveProposalReviewMetadata } from '../../../../application/usecases/proposal/review-metadata';
import { MysqlClient, MysqlConnection } from '../../mysql/mysql.connection';
import { ensureMysqlCatalogSchema } from './mysql.catalog-schema';

interface FileMetaEntry {
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  updatedAt?: string;
}

function toMysqlDateTime(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseMysqlDateTime(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function requireMysqlDateTime(value: Date | string, fieldName: string): Date {
  const parsed = parseMysqlDateTime(value);
  if (!parsed) {
    throw new StorageError(`Invalid MySQL datetime in ${fieldName}: ${String(value)}`);
  }
  return parsed;
}

export class MysqlSkillCatalog implements SkillCatalogPort {
  private readonly schemaReady: Promise<void>;

  constructor(
    private readonly dataDir: string,
    private readonly dbClient: MysqlClient
  ) {
    this.schemaReady = ensureMysqlCatalogSchema(this.dbClient);
  }

  private async ensureSchema(): Promise<void> {
    await this.schemaReady;
  }

  private async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.ensureSchema();
    await this.dbClient.execute(sql, params);
  }

  private async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.ensureSchema();
    return this.dbClient.query<T>(sql, params);
  }

  private async withTransaction<T>(handler: (connection: MysqlConnection) => Promise<T>): Promise<T> {
    await this.ensureSchema();
    return this.dbClient.withTransaction(handler);
  }

  async upsertSkill(skill: Skill): Promise<void> {
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
        tags: version.manifest.tags,
        title: version.manifest.title,
        description: version.manifest.description,
        category: version.manifest.category,
        capabilities: version.manifest.capabilities,
        useWhen: version.manifest.useWhen,
        doNotUseWhen: version.manifest.doNotUseWhen,
        entrypoint: version.manifest.entrypoint,
        status: version.status,
        skillUuid: computeSkillUuid(skill.id.toString()),
        versionUuid: computeVersionUuid(skill.id.toString(), version.version),
        contentDigest: computeContentDigestForVersion(version),
        createdAt: version.createdAt,
        approvedBy: version.approvedBy,
        approvedAt: version.approvedAt ?? null,
        publishedBy: version.publishedBy,
        publishedAt: version.publishedAt ?? null,
        rejectedBy: version.rejectedBy,
        rejectedAt: version.rejectedAt ?? null,
        rejectionReason: version.rejectionReason,
        deprecatedBy: version.deprecatedBy,
        deprecatedAt: version.deprecatedAt ?? null,
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

    await this.withTransaction(async (connection) => {
      await connection.execute('DELETE FROM skill_catalog_files WHERE skill_id = ?', [skill.id.toString()]);
      await connection.execute(
        'DELETE FROM skill_catalog_version_tags WHERE skill_id = ?',
        [skill.id.toString()]
      );
      await connection.execute('DELETE FROM skill_catalog_versions WHERE skill_id = ?', [skill.id.toString()]);

      const insertVersion = `
        INSERT INTO skill_catalog_versions (
          skill_id, version, title, description, category, capabilities, use_when, do_not_use_when, entrypoint,
          status, skill_uuid, version_uuid, content_digest, created_at, approved_by, approved_at, published_by,
          published_at, rejected_by, rejected_at, rejection_reason, deprecated_by, deprecated_at, deprecation_reason,
          updated_at, is_latest_published, is_latest_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const insertFile = `
        INSERT INTO skill_catalog_files (
          skill_id, version, path, artifact_id, role, mime_type, size_bytes, sha256, updated_at, extractable
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          artifact_id = VALUES(artifact_id),
          role = VALUES(role),
          mime_type = VALUES(mime_type),
          size_bytes = VALUES(size_bytes),
          sha256 = VALUES(sha256),
          updated_at = VALUES(updated_at),
          extractable = VALUES(extractable)
      `;
      const insertTag = `
        INSERT INTO skill_catalog_version_tags (skill_id, version, tag)
        VALUES (?, ?, ?)
      `;

      for (const row of versionRows) {
        await connection.execute(insertVersion, [
          row.skillId,
          row.version,
          row.title,
          row.description,
          row.category,
          JSON.stringify(row.capabilities),
          JSON.stringify(row.useWhen),
          JSON.stringify(row.doNotUseWhen),
          row.entrypoint,
          row.status,
          row.skillUuid,
          row.versionUuid,
          row.contentDigest,
          toMysqlDateTime(row.createdAt),
          row.approvedBy,
          toMysqlDateTime(row.approvedAt),
          row.publishedBy,
          toMysqlDateTime(row.publishedAt),
          row.rejectedBy,
          toMysqlDateTime(row.rejectedAt),
          row.rejectionReason,
          row.deprecatedBy,
          toMysqlDateTime(row.deprecatedAt),
          row.deprecationReason,
          toMysqlDateTime(row.updatedAt),
          row.isLatestPublished,
          row.isLatestVersion,
        ]);
        for (const tag of row.tags) {
          await connection.execute(insertTag, [row.skillId, row.version, tag]);
        }
      }

      for (const row of fileRows) {
        await connection.execute(insertFile, [
          row.skillId,
          row.version,
          row.path,
          row.artifactId,
          row.role,
          row.mimeType,
          row.sizeBytes,
          row.sha256,
          toMysqlDateTime(row.updatedAt),
          row.extractable,
        ]);
      }
    });
  }

  async upsertProposal(proposal: Proposal): Promise<void> {
    const review = deriveProposalReviewMetadata({
      title: proposal.title,
      description: proposal.description,
      entrypoint: proposal.entrypoint,
      tags: proposal.tags,
      capabilities: proposal.capabilities,
      judgements: proposal.judgements,
      files: proposal.files.map((file) => ({ path: file.path, mimeType: file.mimeType })),
    });

    await this.withTransaction(async (connection) => {
      await connection.execute(
        `
          INSERT INTO skill_catalog_proposals (
            id, skill_id, title, description, category, tags, capabilities, entrypoint, status,
            submitted_by, created_at, rejection_reason, latest_judgement_risk, review_labels,
            latest_judgement_id, latest_judged_at, content_digest
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            skill_id = VALUES(skill_id),
            title = VALUES(title),
            description = VALUES(description),
            category = VALUES(category),
            tags = VALUES(tags),
            capabilities = VALUES(capabilities),
            entrypoint = VALUES(entrypoint),
            status = VALUES(status),
            submitted_by = VALUES(submitted_by),
            created_at = VALUES(created_at),
            rejection_reason = VALUES(rejection_reason),
            latest_judgement_risk = VALUES(latest_judgement_risk),
            review_labels = VALUES(review_labels),
            latest_judgement_id = VALUES(latest_judgement_id),
            latest_judged_at = VALUES(latest_judged_at),
            content_digest = VALUES(content_digest)
        `,
        [
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
          toMysqlDateTime(proposal.createdAt),
          proposal.rejectionReason,
          review.latestJudgementRisk,
          JSON.stringify(review.labels),
          review.latestJudgementId,
          toMysqlDateTime(review.latestJudgedAt),
          proposal.contentDigest,
        ]
      );
      await connection.execute('DELETE FROM skill_catalog_proposal_files WHERE proposal_id = ?', [proposal.id]);
      await connection.execute('DELETE FROM skill_catalog_judgements WHERE proposal_id = ?', [proposal.id]);

      const insertFile = `
        INSERT INTO skill_catalog_proposal_files (
          proposal_id, id, path, mime_type, size_bytes, sha256
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          id = VALUES(id),
          mime_type = VALUES(mime_type),
          size_bytes = VALUES(size_bytes),
          sha256 = VALUES(sha256)
      `;
      for (const file of proposal.files) {
        await connection.execute(insertFile, [
          proposal.id,
          file.id,
          file.path,
          file.mimeType,
          file.sizeBytes,
          file.sha256,
        ]);
      }

      const insertJudgement = `
        INSERT INTO skill_catalog_judgements (
          id, target_type, target_id, proposal_id, skill_id, skill_version,
          dimensions, overall_risk, summary, skill_purpose_summary, model, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      for (const judgement of proposal.judgements) {
        await connection.execute(insertJudgement, [
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
          toMysqlDateTime(judgement.createdAt),
        ]);
      }
    });
  }

  async deleteProposal(proposalId: string): Promise<void> {
    await this.withTransaction(async (connection) => {
      await connection.execute('DELETE FROM skill_catalog_proposals WHERE id = ?', [proposalId]);
      await connection.execute('DELETE FROM skill_catalog_proposal_files WHERE proposal_id = ?', [proposalId]);
      await connection.execute('DELETE FROM skill_catalog_judgements WHERE proposal_id = ?', [proposalId]);
    });
  }

  async upsertSkillJudgement(skillId: string, version: string, judgement: Judgement): Promise<void> {
    await this.execute(`
      INSERT INTO skill_catalog_judgements (
        id, target_type, target_id, proposal_id, skill_id, skill_version,
        dimensions, overall_risk, summary, skill_purpose_summary, model, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        target_type = VALUES(target_type),
        target_id = VALUES(target_id),
        proposal_id = VALUES(proposal_id),
        skill_id = VALUES(skill_id),
        skill_version = VALUES(skill_version),
        dimensions = VALUES(dimensions),
        overall_risk = VALUES(overall_risk),
        summary = VALUES(summary),
        skill_purpose_summary = VALUES(skill_purpose_summary),
        model = VALUES(model),
        created_at = VALUES(created_at)
    `, [
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
      toMysqlDateTime(judgement.createdAt),
    ]);
  }

  async listJudgements(targetType: JudgementTargetType, targetId: string): Promise<CatalogJudgementRecord[]> {
    const rows = await this.query<CatalogJudgementRow>(`
      SELECT *
      FROM skill_catalog_judgements
      WHERE target_type = ? AND target_id = ?
      ORDER BY created_at
    `, [targetType, targetId]);

    return rows.map(mapCatalogJudgementRow);
  }

  async upsertAuditEntry(entry: AuditEntry): Promise<void> {
    await this.execute(`
      INSERT INTO skill_catalog_audit_entries (
        id, skill_id, skill_version, proposal_id, action, actor, before_json, after_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        skill_id = VALUES(skill_id),
        skill_version = VALUES(skill_version),
        proposal_id = VALUES(proposal_id),
        action = VALUES(action),
        actor = VALUES(actor),
        before_json = VALUES(before_json),
        after_json = VALUES(after_json),
        created_at = VALUES(created_at)
    `, [
      entry.id,
      entry.skillId,
      entry.skillVersion,
      entry.proposalId,
      entry.action,
      entry.actor,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
      toMysqlDateTime(entry.createdAt),
    ]);
  }

  async listSkillHistory(skillId: string): Promise<CatalogAuditEntryRecord[]> {
    const rows = await this.query<CatalogAuditEntryRow>(`
      SELECT *
      FROM skill_catalog_audit_entries
      WHERE skill_id = ?
      ORDER BY created_at
    `, [skillId]);

    return rows.map(mapCatalogAuditEntryRow);
  }

  async listProposals(options?: { skillId?: string; status?: string; limit?: number; offset?: number }): Promise<{ items: CatalogProposalRecord[]; total: number }> {
    const statuses = normalizeStatusFilter(options?.status);
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options?.skillId) {
      clauses.push('skill_id = ?');
      params.push(options.skillId);
    }
    if (statuses.length === 1) {
      clauses.push('status = ?');
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const totalRows = await this.query<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM skill_catalog_proposals
      ${where}
    `, params);
    const limit = sanitizeLimit(options?.limit, 200);
    const offset = sanitizeOffset(options?.offset);

    const rows = await this.query<CatalogProposalRow>(`
      ${buildProposalSelect()}
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `, params);

    return {
      items: rows.map(mapCatalogProposalRow),
      total: totalRows[0]?.count ?? 0,
    };
  }

  async getProposal(proposalId: string): Promise<CatalogProposalRecord | null> {
    const rows = await this.query<CatalogProposalRow>(`
      ${buildProposalSelect()}
      WHERE id = ?
      LIMIT 1
    `, [proposalId]);
    return rows[0] ? mapCatalogProposalRow(rows[0]) : null;
  }

  async findProposalByContentDigest(contentDigest: string, excludeId?: string): Promise<CatalogProposalRecord | null> {
    const rows = excludeId
      ? await this.query<CatalogProposalRow>(`
          ${buildProposalSelect()}
          WHERE content_digest = ? AND id != ?
          ORDER BY created_at DESC
          LIMIT 1
        `, [contentDigest, excludeId])
      : await this.query<CatalogProposalRow>(`
          ${buildProposalSelect()}
          WHERE content_digest = ?
          ORDER BY created_at DESC
          LIMIT 1
        `, [contentDigest]);
    return rows[0] ? mapCatalogProposalRow(rows[0]) : null;
  }

  async findPublishedSkillByContentDigest(contentDigest: string): Promise<{ skillId: string; version: string } | null> {
    const rows = await this.query<{ skill_id: string; version: string }>(`
      SELECT skill_id, version
      FROM skill_catalog_versions
      WHERE content_digest = ? AND status = 'published'
      LIMIT 1
    `, [contentDigest]);
    if (!rows[0]) {
      return null;
    }
    return { skillId: rows[0].skill_id, version: rows[0].version };
  }

  async listProposalFiles(proposalId: string): Promise<CatalogProposalFileRecord[]> {
    const rows = await this.query<CatalogProposalFileRow>(`
      SELECT *
      FROM skill_catalog_proposal_files
      WHERE proposal_id = ?
      ORDER BY path
    `, [proposalId]);
    return rows.map(mapCatalogProposalFileRow);
  }

  async listProposalJudgements(proposalId: string): Promise<CatalogJudgementRecord[]> {
    const rows = await this.query<CatalogJudgementRow>(`
      SELECT *
      FROM skill_catalog_judgements
      WHERE proposal_id = ?
      ORDER BY created_at
    `, [proposalId]);
    return rows.map(mapCatalogJudgementRow);
  }

  async countPendingProposals(): Promise<number> {
    const rows = await this.query<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM skill_catalog_proposals
      WHERE status IN (?, ?)
    `, [ProposalStatus.SUBMITTED, ProposalStatus.JUDGED]);
    return rows[0]?.count ?? 0;
  }

  async rebuild(skills: Skill[], options?: { clearProjections?: boolean }): Promise<void> {
    const clearProjections = options?.clearProjections ?? false;
    if (clearProjections) {
      await this.execute('DELETE FROM skill_catalog_audit_entries');
      await this.execute('DELETE FROM skill_catalog_judgements');
      await this.execute('DELETE FROM skill_catalog_proposal_files');
      await this.execute('DELETE FROM skill_catalog_proposals');
      await this.execute('DELETE FROM skill_catalog_version_tags');
      await this.execute('DELETE FROM skill_catalog_files');
      await this.execute('DELETE FROM skill_catalog_versions');
    } else {
      await this.execute('DELETE FROM skill_catalog_files');
      await this.execute('DELETE FROM skill_catalog_version_tags');
      await this.execute('DELETE FROM skill_catalog_versions');
    }
    for (const skill of skills) {
      await this.upsertSkill(skill);
    }
  }

  async listCategories(): Promise<string[]> {
    const rows = await this.query<{ category: string }>(`
      SELECT DISTINCT category
      FROM skill_catalog_versions
      WHERE status = 'published' AND is_latest_published = 1
      ORDER BY category
    `);
    return rows.map((row) => row.category);
  }

  async listTags(): Promise<string[]> {
    const rows = await this.query<{ tag: string }>(`
      SELECT DISTINCT vtag.tag AS tag
      FROM skill_catalog_version_tags vtag
      JOIN skill_catalog_versions v
        ON v.skill_id = vtag.skill_id AND v.version = vtag.version
      WHERE v.status = 'published' AND v.is_latest_published = 1
      ORDER BY tag
    `);
    return rows.map((row) => row.tag).filter(Boolean);
  }

  async listLatestSkillVersions(options?: {
    category?: string;
    publishedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: CatalogSkillVersionRecord[]; total: number }> {
    const publishedOnly = options?.publishedOnly ?? false;
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const params: Array<string | number> = [];
    const whereParts: string[] = [];

    if (publishedOnly) {
      whereParts.push("v.status = 'published'");
      whereParts.push('v.is_latest_published = 1');
    } else {
      whereParts.push('v.is_latest_version = 1');
    }

    if (options?.category) {
      whereParts.push('v.category = ?');
      params.push(options.category);
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const totalRows = await this.query<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM skill_catalog_versions v
      ${where}
    `, params);
    const safeLimit = sanitizeLimit(limit, 50);
    const safeOffset = sanitizeOffset(offset);

    const rows = await this.query<CatalogVersionRowWithTags>(`
      SELECT v.*, COALESCE(tags.tag_list, '[]') AS tag_list
      FROM skill_catalog_versions v
      LEFT JOIN (
        SELECT skill_id, version, JSON_ARRAYAGG(tag) AS tag_list
        FROM skill_catalog_version_tags
        GROUP BY skill_id, version
      ) tags ON tags.skill_id = v.skill_id AND tags.version = v.version
      ${where}
      ORDER BY v.skill_id
      LIMIT ${safeLimit}
      OFFSET ${safeOffset}
    `, params);

    const items = rows.map(mapCatalogVersionRowWithTags);
    return {
      items,
      total: totalRows[0]?.count ?? 0,
    };
  }

  async listPublishedSkillRefs(
    category?: string,
    limit = 50,
    offset = 0
  ): Promise<{ items: CatalogSkillRef[]; total: number }> {
    const where = category
      ? `WHERE status = 'published' AND is_latest_published = 1 AND category = ?`
      : `WHERE status = 'published' AND is_latest_published = 1`;
    const params = category ? [category] : [];
    const totalRows = await this.query<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM skill_catalog_versions
      ${where}
    `, params);
    const safeLimit = sanitizeLimit(limit, 50);
    const safeOffset = sanitizeOffset(offset);
    const rows = await this.query<{ skill_id: string; version: string }>(`
      SELECT skill_id, version
      FROM skill_catalog_versions
      ${where}
      ORDER BY skill_id
      LIMIT ${safeLimit}
      OFFSET ${safeOffset}
    `, params);
    return {
      items: rows.map((row) => ({ skillId: row.skill_id, version: row.version })),
      total: totalRows[0]?.count ?? 0,
    };
  }

  async getLatestPublishedVersion(skillId: string): Promise<CatalogSkillVersionRecord | null> {
    const rows = await this.query<CatalogVersionRowWithTags>(`
      SELECT v.*, COALESCE(tags.tag_list, '[]') AS tag_list
      FROM skill_catalog_versions v
      LEFT JOIN (
        SELECT skill_id, version, JSON_ARRAYAGG(tag) AS tag_list
        FROM skill_catalog_version_tags
        GROUP BY skill_id, version
      ) tags ON tags.skill_id = v.skill_id AND tags.version = v.version
      WHERE v.skill_id = ? AND v.status = 'published' AND v.is_latest_published = 1
      LIMIT 1
    `, [skillId]);
    return rows[0] ? mapCatalogVersionRowWithTags(rows[0]) : null;
  }

  async getSkillVersion(skillId: string, version: string): Promise<CatalogSkillVersionRecord | null> {
    const rows = await this.query<CatalogVersionRowWithTags>(`
      SELECT v.*, COALESCE(tags.tag_list, '[]') AS tag_list
      FROM skill_catalog_versions v
      LEFT JOIN (
        SELECT skill_id, version, JSON_ARRAYAGG(tag) AS tag_list
        FROM skill_catalog_version_tags
        GROUP BY skill_id, version
      ) tags ON tags.skill_id = v.skill_id AND tags.version = v.version
      WHERE v.skill_id = ? AND v.version = ?
      LIMIT 1
    `, [skillId, version]);
    return rows[0] ? mapCatalogVersionRowWithTags(rows[0]) : null;
  }

  async getLatestVersion(skillId: string): Promise<CatalogSkillVersionRecord | null> {
    const rows = await this.query<CatalogVersionRowWithTags>(`
      SELECT v.*, COALESCE(tags.tag_list, '[]') AS tag_list
      FROM skill_catalog_versions v
      LEFT JOIN (
        SELECT skill_id, version, JSON_ARRAYAGG(tag) AS tag_list
        FROM skill_catalog_version_tags
        GROUP BY skill_id, version
      ) tags ON tags.skill_id = v.skill_id AND tags.version = v.version
      WHERE v.skill_id = ? AND v.is_latest_version = 1
      LIMIT 1
    `, [skillId]);
    return rows[0] ? mapCatalogVersionRowWithTags(rows[0]) : null;
  }

  async listSkillVersions(skillId: string, options?: { publishedOnly?: boolean }): Promise<CatalogSkillVersionRecord[]> {
    const where = options?.publishedOnly ? `AND status = 'published'` : '';
    const rows = await this.query<CatalogVersionRowWithTags>(`
      SELECT v.*, COALESCE(tags.tag_list, '[]') AS tag_list
      FROM skill_catalog_versions v
      LEFT JOIN (
        SELECT skill_id, version, JSON_ARRAYAGG(tag) AS tag_list
        FROM skill_catalog_version_tags
        GROUP BY skill_id, version
      ) tags ON tags.skill_id = v.skill_id AND tags.version = v.version
      WHERE v.skill_id = ? ${where}
      ORDER BY v.created_at, v.version
    `, [skillId]);
    return rows.map(mapCatalogVersionRowWithTags);
  }

  async listPublishedVersions(skillId: string): Promise<CatalogSkillVersionRecord[]> {
    return this.listSkillVersions(skillId, { publishedOnly: true });
  }

  async listVersionFiles(skillId: string, version: string): Promise<CatalogSkillFileRecord[]> {
    const rows = await this.query<CatalogFileRow>(`
      SELECT *
      FROM skill_catalog_files
      WHERE skill_id = ? AND version = ?
      ORDER BY path
    `, [skillId, version]);
    return rows.map((row) => ({
      skillId: row.skill_id,
      version: row.version,
      path: row.path,
      artifactId: row.artifact_id,
      role: row.role,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      updatedAt: parseMysqlDateTime(row.updated_at),
      extractable: row.extractable === 1,
    }));
  }

  private async readFileMeta(skillId: string, version: string): Promise<Record<string, FileMetaEntry>> {
    const dbMeta = await this.readDatabaseFileMeta(skillId, version);
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

  private async readDatabaseFileMeta(skillId: string, version: string): Promise<Record<string, FileMetaEntry>> {
    try {
      const rows = await this.query<{
        path: string;
        mime_type: string;
        size_bytes: number;
        sha256: string | null;
        updated_at: string | null;
      }>(`
        SELECT path, mime_type, size_bytes, sha256, updated_at
        FROM content_skill_files
        WHERE skill_id = ? AND version = ?
      `, [skillId, version]);
      return Object.fromEntries(rows.map((row) => [row.path, {
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
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
      .filter((entry): entry is string => Boolean(entry))
      .sort();
    return timestamps[timestamps.length - 1] ?? null;
  }

}

function normalizeStatusFilter(status?: string): string[] {
  if (!status) {
    return [];
  }
  return status
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function sanitizeLimit(value: number | undefined, defaultValue: number): number {
  const normalized = value ?? defaultValue;
  if (!Number.isInteger(normalized) || normalized < 0) {
    return defaultValue;
  }
  return normalized;
}

function sanitizeOffset(value: number | undefined): number {
  const normalized = value ?? 0;
  if (!Number.isInteger(normalized) || normalized < 0) {
    return 0;
  }
  return normalized;
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
  const normalized = normalizeJudgementOverallRisk(effectiveRisk, latestJudgementModel, {});
  return normalized;
}

interface CatalogVersionRow {
  skill_id: string;
  version: string;
  title: string;
  description: string;
  category: string;
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

interface CatalogVersionRowWithTags extends CatalogVersionRow {
  tag_list: string;
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

function mapCatalogVersionRowWithTags(row: CatalogVersionRowWithTags): CatalogSkillVersionRecord {
  const tags = parseTagList(row.tag_list);
  return {
    skillId: row.skill_id,
    version: row.version,
    title: row.title,
    description: row.description,
    category: row.category,
    tags,
    capabilities: parseStringArray(row.capabilities),
    useWhen: parseStringArray(row.use_when),
    doNotUseWhen: parseStringArray(row.do_not_use_when),
    entrypoint: row.entrypoint,
    status: row.status,
    skillUuid: row.skill_uuid,
    versionUuid: row.version_uuid,
    contentDigest: row.content_digest,
    createdAt: requireMysqlDateTime(row.created_at, 'skill_catalog_versions.created_at'),
    approvedBy: row.approved_by,
    approvedAt: parseMysqlDateTime(row.approved_at),
    publishedBy: row.published_by,
    publishedAt: parseMysqlDateTime(row.published_at),
    rejectedBy: row.rejected_by,
    rejectedAt: parseMysqlDateTime(row.rejected_at),
    rejectionReason: row.rejection_reason,
    deprecatedBy: row.deprecated_by,
    deprecatedAt: parseMysqlDateTime(row.deprecated_at),
    deprecationReason: row.deprecation_reason,
    updatedAt: parseMysqlDateTime(row.updated_at),
    isLatestPublished: row.is_latest_published === 1,
    isLatestVersion: row.is_latest_version === 1,
  };
}

function mapCatalogJudgementRow(row: CatalogJudgementRow): CatalogJudgementRecord {
  const dimensions = parseJsonObject<CatalogJudgementRecord['dimensions']>(row.dimensions);
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
    createdAt: requireMysqlDateTime(row.created_at, 'skill_catalog_judgements.created_at'),
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
    before: row.before_json ? parseJsonObject<CatalogAuditEntryRecord['before']>(row.before_json) : null,
    after: row.after_json ? parseJsonObject<CatalogAuditEntryRecord['after']>(row.after_json) : null,
    createdAt: requireMysqlDateTime(row.created_at, 'skill_catalog_audit_entries.created_at'),
  };
}

function mapCatalogProposalRow(row: CatalogProposalRow): CatalogProposalRecord {
  return {
    id: row.id,
    skillId: row.skill_id,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: parseStringArray(row.tags),
    capabilities: parseStringArray(row.capabilities),
    entrypoint: row.entrypoint,
    status: row.status as CatalogProposalRecord['status'],
    submittedBy: row.submitted_by,
    createdAt: requireMysqlDateTime(row.created_at, 'skill_catalog_proposals.created_at'),
    rejectionReason: row.rejection_reason,
    latestJudgementRisk: resolveLatestProposalJudgementRisk(
      row.latest_judgement_risk,
      row.latest_judgement_overall_risk,
      row.latest_judgement_model,
      row.latest_judgement_id
    ),
    labels: parseStringArray(row.review_labels) as CatalogProposalRecord['labels'],
    latestJudgementId: row.latest_judgement_id,
    latestJudgedAt: parseMysqlDateTime(row.latest_judged_at),
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

function parseTagList(value: string | string[] | null | undefined): string[] {
  try {
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
    if (typeof value !== 'string') {
      return [];
    }
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item));
    }
  } catch {
    // fall through
  }
  return [];
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item));
    }
  } catch {}
  return [];
}

function parseJsonObject<T>(value: unknown): T {
  if (value === null || value === undefined) {
    return {} as T;
  }
  if (typeof value === 'object') {
    return value as T;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed as T;
      }
    } catch {}
  }
  return {} as T;
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
