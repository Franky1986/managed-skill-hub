import { afterEach, describe, expect, it } from 'vitest';
import path from 'path';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import { AuditEntry } from '../../../../domain/audit/AuditEntry';
import { Judgement, JudgementRisk } from '../../../../domain/judgement/Judgement';
import { Proposal, ProposalFile } from '../../../../domain/proposal/Proposal';
import { Manifest } from '../../../../domain/skill/Manifest';
import { ManifestFile } from '../../../../domain/skill/ManifestFile';
import { Skill } from '../../../../domain/skill/Skill';
import { SkillId } from '../../../../domain/skill/SkillId';
import { SkillStatus } from '../../../../domain/skill/SkillStatus';
import { SkillVersion } from '../../../../domain/skill/SkillVersion';
import { MysqlSkillCatalog } from './mysql.skill-catalog';

interface VersionRow {
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

interface FileRow {
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

interface ProposalRow {
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
  review_labels: string;
  latest_judgement_id: string | null;
  latest_judged_at: string | null;
  content_digest: string | null;
  latest_judgement_overall_risk: string | null;
  latest_judgement_model: string | null;
}

interface ProposalFileRow {
  proposal_id: string;
  id: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string | null;
}

interface JudgementRow {
  id: string;
  target_type: string;
  target_id: string;
  proposal_id: string | null;
  skill_id: string | null;
  skill_version: string | null;
  dimensions: string;
  overall_risk: string;
  summary: string;
  skill_purpose_summary: string | null;
  model: string | null;
  created_at: string;
}

interface AuditRow {
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

class FakeMysqlClient {
  private versions = new Map<string, VersionRow>();
  private files = new Map<string, FileRow>();
  private versionTags = new Set<string>();
  private proposals = new Map<string, ProposalRow>();
  private proposalFiles = new Map<string, ProposalFileRow>();
  private judgements = new Map<string, JudgementRow>();
  private auditEntries = new Map<string, AuditRow>();

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const normalized = normalize(sql);

    if (normalized.includes('from skill_catalog_versions') && normalized.includes('count')) {
      return this.queryCount(normalized, params) as T[];
    }
    if (normalized.includes('from skill_catalog_versions')) {
      if (normalized.includes('left join')) {
        return this.queryVersionWithTags(params, normalized.includes('where status =') ? true : false) as T[];
      }
      if (normalized.includes('coalesce(tags.tag_list')) {
        return this.queryVersionWithTags(params, false) as T[];
      }
      if (normalized.includes('where v.skill_id = ?')) {
        return this.queryVersionsForSkill(params) as T[];
      }
      if (normalized.includes('group by skill_id, version')) {
        return this.queryVersionsForPublishedRefs(params) as T[];
      }
      return this.queryVersions(params, normalized.includes('published') || normalized.includes('is_latest_published')) as T[];
    }

    if (normalized.includes('from skill_catalog_files')) {
      return this.queryFiles(params) as T[];
    }

    if (normalized.includes('from skill_catalog_version_tags') && normalized.includes('select')) {
      if (normalized.includes('select distinct vtag.tag')) {
        return this.queryTagList() as T[];
      }
      return [] as T[];
    }

    if (normalized.includes('from skill_catalog_proposals')) {
      if (normalized.includes('count(*)')) {
        return this.queryCount(normalized, params) as T[];
      }
      if (normalized.includes('where id = ?')) {
        return this.queryProposalById(params) as T[];
      }
      if (normalized.includes('where content_digest = ?')) {
        return this.queryProposalByContentDigest(params) as T[];
      }
      return this.queryProposals(params, normalized) as T[];
    }

    if (normalized.includes('from skill_catalog_proposal_files')) {
      return this.queryProposalFiles(params) as T[];
    }

    if (normalized.includes('from skill_catalog_judgements')) {
      if (normalized.includes('where target_type = ? and target_id = ?')) {
        return this.queryJudgementsByTarget(params[0] as string, params[1] as string) as T[];
      }
      if (normalized.includes('where proposal_id = ?')) {
        return this.queryJudgementsByProposal(params[0] as string) as T[];
      }
      return [] as T[];
    }

    if (normalized.includes('from skill_catalog_audit_entries')) {
      if (normalized.includes('where skill_id = ?')) {
        return this.queryAuditEntriesBySkill(params[0] as string) as T[];
      }
      return [] as T[];
    }

    return [] as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const normalized = normalize(sql);
    if (normalized.startsWith('create table')) {
      return;
    }
    if (normalized.startsWith('delete from skill_catalog_files')) {
      if (normalized.includes('where skill_id = ?')) {
        this.deleteSkillFiles(String(params[0]));
        return;
      }
      this.files.clear();
      return;
    }
    if (normalized.startsWith('delete from skill_catalog_version_tags')) {
      if (normalized.includes('where skill_id = ?')) {
        this.deleteSkillVersionTags(String(params[0]));
        return;
      }
      this.versionTags.clear();
      return;
    }
    if (normalized.startsWith('delete from skill_catalog_versions')) {
      if (normalized.includes('where skill_id = ?')) {
        this.deleteSkillVersions(String(params[0]));
        return;
      }
      if (normalized.includes('where skill_id = ? and version = ?')) {
        this.versions.delete(this.versionKey(String(params[0]), String(params[1])));
        return;
      }
      this.versions.clear();
      return;
    }
    if (normalized.includes('delete from skill_catalog_audit_entries')) {
      this.auditEntries.clear();
      return;
    }
    if (normalized.includes('delete from skill_catalog_judgements')) {
      this.deleteJudgementsForProposal(String(params[0]));
      return;
    }
    if (normalized.includes('delete from skill_catalog_proposal_files')) {
      this.deleteProposalFiles(String(params[0]));
      return;
    }
    if (normalized.includes('delete from skill_catalog_proposals')) {
      const id = String(params[0]);
      this.proposals.delete(id);
      this.deleteProposalFiles(id);
      this.deleteJudgementsForProposal(id);
      return;
    }

    if (normalized.includes('insert into skill_catalog_versions')) {
      this.insertVersion(params);
      return;
    }

    if (normalized.includes('insert into skill_catalog_version_tags')) {
      const [skillId, version, tag] = params as [string, string, string];
      this.versionTags.add(this.versionTagKey(skillId, version, tag));
      return;
    }

    if (normalized.includes('insert into skill_catalog_files')) {
      const [skillId, version, filePath, artifactId, role, mimeType, sizeBytes, sha256, updatedAt] = params;
      const key = this.fileKey(String(skillId), String(version), String(filePath));
      this.files.set(key, {
        skill_id: String(skillId),
        version: String(version),
        path: String(filePath),
        artifact_id: String(artifactId),
        role: String(role),
        mime_type: String(mimeType),
        size_bytes: Number(sizeBytes),
        sha256: typeof sha256 === 'string' ? sha256 : null,
        updated_at: updatedAt ? String(updatedAt) : null,
        extractable: this.extractableFromMime(mimeType as string),
      });
      return;
    }

    if (normalized.includes('insert into skill_catalog_proposals')) {
      const [
        id, skillId, title, description, category, tags, capabilities, entrypoint, status, submittedBy,
        createdAt, rejectionReason, latestRisk, reviewLabels, latestJudgementId, latestJudgedAt, contentDigest,
      ] = params as (string | null)[];
      this.proposals.set(String(id), {
        id: String(id),
        skill_id: skillId,
        title: String(title),
        description: String(description),
        category: String(category),
        tags: String(tags),
        capabilities: String(capabilities),
        entrypoint: entrypoint ? String(entrypoint) : null,
        status: String(status),
        submitted_by: String(submittedBy),
        created_at: String(createdAt),
        rejection_reason: rejectionReason ? String(rejectionReason) : null,
        latest_judgement_risk: latestRisk ? String(latestRisk) : null,
        review_labels: String(reviewLabels),
        latest_judgement_id: latestJudgementId ? String(latestJudgementId) : null,
        latest_judged_at: latestJudgedAt ? String(latestJudgedAt) : null,
        content_digest: contentDigest ? String(contentDigest) : null,
      });
      return;
    }

    if (normalized.includes('insert into skill_catalog_proposal_files')) {
      const [proposalId, fileId, filePath, mimeType, sizeBytes, sha256] = params;
      const key = this.proposalFileKey(String(proposalId), String(fileId));
      this.proposalFiles.set(key, {
        proposal_id: String(proposalId),
        id: String(fileId),
        path: String(filePath),
        mime_type: String(mimeType),
        size_bytes: Number(sizeBytes),
        sha256: typeof sha256 === 'string' ? sha256 : null,
      });
      return;
    }

    if (normalized.includes('insert into skill_catalog_judgements')) {
      const [
        id, targetType, targetId, proposalId, skillId, skillVersion,
        dimensions, overallRisk, summary, skillPurposeSummary, model, createdAt,
      ] = params;
      this.judgements.set(String(id), {
        id: String(id),
        target_type: String(targetType),
        target_id: String(targetId),
        proposal_id: typeof proposalId === 'string' ? proposalId : null,
        skill_id: typeof skillId === 'string' ? skillId : null,
        skill_version: typeof skillVersion === 'string' ? skillVersion : null,
        dimensions: String(dimensions),
        overall_risk: String(overallRisk),
        summary: String(summary),
        skill_purpose_summary: typeof skillPurposeSummary === 'string' ? skillPurposeSummary : null,
        model: typeof model === 'string' ? model : null,
        created_at: String(createdAt),
      });
      return;
    }

    if (normalized.includes('insert into skill_catalog_audit_entries')) {
      const [id, skillId, skillVersion, proposalId, action, actor, beforeJson, afterJson, createdAt] = params;
      this.auditEntries.set(String(id), {
        id: String(id),
        skill_id: typeof skillId === 'string' ? skillId : null,
        skill_version: typeof skillVersion === 'string' ? skillVersion : null,
        proposal_id: typeof proposalId === 'string' ? proposalId : null,
        action: String(action),
        actor: String(actor),
        before_json: typeof beforeJson === 'string' ? beforeJson : null,
        after_json: typeof afterJson === 'string' ? afterJson : null,
        created_at: String(createdAt),
      });
      return;
    }
  }

  async withTransaction<T>(handler: (connection: {
    execute: (sql: string, params?: unknown[]) => Promise<void>;
    query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  }) => Promise<T>): Promise<T> {
    return handler({
      execute: (sql, params) => this.execute(sql, params),
      query: (sql, params) => this.query(sql, params),
    });
  }

  reset(): void {
    this.versions.clear();
    this.files.clear();
    this.versionTags.clear();
    this.proposals.clear();
    this.proposalFiles.clear();
    this.judgements.clear();
    this.auditEntries.clear();
  }

  private versionKey(skillId: string, version: string): string {
    return `${skillId}:${version}`;
  }

  private versionTagKey(skillId: string, version: string, tag: string): string {
    return `${this.versionKey(skillId, version)}:${tag}`;
  }

  private fileKey(skillId: string, version: string, filePath: string): string {
    return `${this.versionKey(skillId, version)}:${filePath}`;
  }

  private proposalFileKey(proposalId: string, fileId: string): string {
    return `${proposalId}:${fileId}`;
  }

  private extractableFromMime(mimeType: string): number {
    if (!mimeType || mimeType === 'application/octet-stream') {
      return 0;
    }
    if (mimeType.startsWith('text/') || mimeType.endsWith('json') || mimeType.endsWith('yaml')) {
      return 1;
    }
    return 0;
  }

  private insertVersion(params: unknown[]): void {
    const [
      skillId, version, title, description, category, capabilities, useWhen, doNotUseWhen,
      entrypoint, status, skillUuid, versionUuid, contentDigest, createdAt, approvedBy, approvedAt,
      publishedBy, publishedAt, rejectedBy, rejectedAt, rejectionReason, deprecatedBy, deprecatedAt,
      deprecationReason, updatedAt, isLatestPublished, isLatestVersion,
    ] = params as [string, string, string, string, string, string, string, string, string, string, string, string, string,
      string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null,
      string | null, string | null, string | null, number, number];

    const row: VersionRow = {
      skill_id: String(skillId),
      version: String(version),
      title: String(title),
      description: String(description),
      category: String(category),
      capabilities: String(capabilities),
      use_when: String(useWhen),
      do_not_use_when: String(doNotUseWhen),
      entrypoint: String(entrypoint),
      status: String(status),
      skill_uuid: String(skillUuid),
      version_uuid: String(versionUuid),
      content_digest: String(contentDigest),
      created_at: String(createdAt),
      approved_by: approvedBy ?? null,
      approved_at: approvedAt ?? null,
      published_by: publishedBy ?? null,
      published_at: publishedAt ?? null,
      rejected_by: rejectedBy ?? null,
      rejected_at: rejectedAt ?? null,
      rejection_reason: rejectionReason ?? null,
      deprecated_by: deprecatedBy ?? null,
      deprecated_at: deprecatedAt ?? null,
      deprecation_reason: deprecationReason ?? null,
      updated_at: updatedAt ?? null,
      is_latest_published: Number(isLatestPublished ?? 0),
      is_latest_version: Number(isLatestVersion ?? 0),
    };
    this.versions.set(this.versionKey(row.skill_id, row.version), row);
  }

  private queryVersions(params: unknown[], onlyPublished: boolean): Array<Omit<VersionRow, never>> {
    const values = [...this.versions.values()];
    const filtered = values.filter((version) => {
      if (onlyPublished && (version.status !== 'published' || version.is_latest_published !== 1)) {
        return false;
      }
      return true;
    });
    return filtered.map((row) => ({
      ...row,
    }));
  }

  private queryVersionsForSkill(params: unknown[]): Array<{ skill_id: string; version: string; created_at: string; status: string }> {
    const [skillId] = params;
    return [...this.versions.values()]
      .filter((row) => row.skill_id === String(skillId))
      .map((row) => ({ skill_id: row.skill_id, version: row.version, created_at: row.created_at, status: row.status }));
  }

  private queryVersionsForPublishedRefs(_params: unknown[]): Array<{ skill_id: string; version: string }> {
    return [...this.versions.values()]
      .filter((row) => row.status === 'published' && row.is_latest_published === 1)
      .map((row) => ({ skill_id: row.skill_id, version: row.version }));
  }

  private queryVersionWithTags(_params: unknown[], limitPublished = false): Array<VersionRow & { tag_list: string }> {
    const rows = this.queryVersions([], limitPublished);
    return rows.map((row) => ({
      ...row,
      tag_list: JSON.stringify(this.tagsForVersion(row.skill_id, row.version)),
    }));
  }

  private queryTagList(): Array<{ tag: string }> {
    const tags = new Set<string>();
    for (const version of this.versions.values()) {
      if (version.status !== 'published' || version.is_latest_published !== 1) {
        continue;
      }
      for (const tag of this.tagsForVersion(version.skill_id, version.version)) {
        if (tag) {
          tags.add(tag);
        }
      }
    }
    return [...tags].sort().map((tag) => ({ tag }));
  }

  private tagsForVersion(skillId: string, version: string): string[] {
    const tags = [];
    const prefix = `${skillId}:${version}:`;
    for (const candidate of this.versionTags) {
      if (!candidate.startsWith(prefix)) {
        continue;
      }
      const tag = candidate.substring(prefix.length);
      if (!tag) {
        continue;
      }
      tags.push(tag);
    }
    return tags.sort();
  }

  private queryFiles(params: unknown[]): FileRow[] {
    const [skillId, version] = params;
    return [...this.files.values()]
      .filter((row) => row.skill_id === String(skillId) && row.version === String(version))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private queryProposals(params: unknown[], normalized = ''): ProposalRow[] {
    const statuses = normalized.includes('status in') || normalized.includes('status =')
      ? new Set(params.map((param) => String(param)))
      : null;
    return [...this.proposals.values()]
      .filter((row) => !statuses || statuses.has(row.status))
      .map((row) => this.hydrateProposalJudgementProjection(row))
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  private queryProposalById(params: unknown[]): ProposalRow[] {
    const proposal = this.proposals.get(String(params[0]));
    return proposal ? [this.hydrateProposalJudgementProjection(proposal)] : [];
  }

  private queryProposalByContentDigest(params: unknown[]): ProposalRow[] {
    const [contentDigest, excludeId] = params;
    const match = [...this.proposals.values()].find((proposal) =>
      proposal.content_digest === String(contentDigest) && (!excludeId || proposal.id !== String(excludeId))
    );
    return match ? [this.hydrateProposalJudgementProjection(match)] : [];
  }

  private queryProposalFiles(params: unknown[]): ProposalFileRow[] {
    const [proposalId] = params;
    return [...this.proposalFiles.values()].filter((row) => row.proposal_id === String(proposalId)).sort((a, b) => a.path.localeCompare(b.path));
  }

  private queryJudgementsByTarget(targetType: string, targetId: string): JudgementRow[] {
    return [...this.judgements.values()]
      .filter((row) => row.target_type === targetType && row.target_id === targetId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  private queryJudgementsByProposal(proposalId: string): JudgementRow[] {
    return [...this.judgements.values()]
      .filter((row) => row.proposal_id === proposalId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  private queryAuditEntriesBySkill(skillId: string): AuditRow[] {
    return [...this.auditEntries.values()]
      .filter((row) => row.skill_id === skillId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  private queryCount(normalized: string, params: unknown[]): Array<{ count: number }> {
    const count = this.queryCountRows(normalized, params);
    return [{ count }];
  }

  private queryCountRows(normalized: string, params: unknown[]): number {
    if (normalized.includes('from skill_catalog_versions')) {
      const rows = this.queryVersions(params, normalized.includes('where') && normalized.includes('status ='));
      return rows.length;
    }
    if (normalized.includes('from skill_catalog_proposals')) {
      return this.queryProposals(params, normalized).length;
    }
    return 0;
  }

  private hydrateProposalJudgementProjection(row: ProposalRow): ProposalRow {
    const latestJudgement = row.latest_judgement_id ? this.judgements.get(row.latest_judgement_id) : undefined;
    return {
      ...row,
      latest_judgement_overall_risk: latestJudgement?.overall_risk ?? row.latest_judgement_overall_risk ?? null,
      latest_judgement_model: latestJudgement?.model ?? row.latest_judgement_model ?? null,
    };
  }

  private deleteSkillVersions(skillId: string): void {
    for (const key of [...this.versions.keys()]) {
      if (key.startsWith(`${skillId}:`)) {
        this.versions.delete(key);
      }
    }
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${skillId}:`)) {
        this.files.delete(key);
      }
    }
    for (const tagKey of [...this.versionTags]) {
      if (tagKey.startsWith(`${skillId}:`)) {
        this.versionTags.delete(tagKey);
      }
    }
  }

  private deleteSkillFiles(skillId: string): void {
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${skillId}:`)) {
        this.files.delete(key);
      }
    }
  }

  private deleteSkillVersionTags(skillId: string): void {
    for (const tagKey of [...this.versionTags]) {
      if (tagKey.startsWith(`${skillId}:`)) {
        this.versionTags.delete(tagKey);
      }
    }
  }

  private deleteProposalFiles(proposalId: string): void {
    for (const key of [...this.proposalFiles.keys()]) {
      if (key.startsWith(`${proposalId}:`)) {
        this.proposalFiles.delete(key);
      }
    }
  }

  private deleteJudgementsForProposal(proposalId: string): void {
    for (const [id, judgement] of [...this.judgements.entries()]) {
      if (judgement.proposal_id === proposalId) {
        this.judgements.delete(id);
      }
    }
  }
}

function normalize(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, ' ');
}

describe('MysqlSkillCatalog', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('projects published refs, latest refs and file metadata into mysql', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-catalog-mysql-'));
    tempDirs.push(dataDir);
    await mkdir(path.join(dataDir, 'skills', 'catalog-skill', '1.0.0'), { recursive: true });
    await writeFile(
      path.join(dataDir, 'skills', 'catalog-skill', '1.0.0', '.meta.json'),
      JSON.stringify({
        'README.md': {
          mimeType: 'text/markdown',
          sizeBytes: 14,
          sha256: 'abc123',
          updatedAt: '2026-07-02T12:00:00.000Z',
        },
      })
    );

    const catalog = new MysqlSkillCatalog(dataDir, new FakeMysqlClient() as unknown as any);

    const skill = Skill.create({ id: SkillId.create('catalog-skill'), createdBy: 'tester' });
    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: '1.0.0',
        createdBy: 'tester',
        manifest: Manifest.create({
          id: 'catalog-skill',
          title: 'Catalog Skill',
          description: 'Projected into MySQL',
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
    const pendingProposals = await catalog.countPendingProposals();

    expect(categories).toEqual(['automation']);
    expect(tags).toEqual(['agent']);
    expect(refs.items).toEqual([{ skillId: 'catalog-skill', version: '1.0.0' }]);
    expect(latest?.contentDigest).toBeTruthy();
    expect(exact?.version).toBe('1.0.0');
    expect(latestAny?.version).toBe('1.0.0');
    expect(latestList.items).toHaveLength(1);
    expect(latestList.items[0]?.isLatestVersion).toBe(true);
    expect(latest?.entrypoint).toBe('README.md');
    expect(versions[0]?.status).toBe('published');
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('README.md');
    expect(files[0]?.extractable).toBe(true);
    expect(files[0]?.sizeBytes).toBe(14);
    expect(pendingProposals).toBe(0);
  });

  it('projects proposal, file and audit metadata into mysql', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-catalog-mysql-'));
    tempDirs.push(dataDir);

    const catalog = new MysqlSkillCatalog(dataDir, new FakeMysqlClient() as unknown as any);

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
    await catalog.upsertSkillJudgement('catalog-skill', '1.0.0', createJudgement('judge-skill', 'skill', 'catalog-skill:1.0.0'));
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

    const proposalList = await catalog.listProposals();
    const proposalFiles = await catalog.listProposalFiles(proposal.id);
    const allProposalJudgements = await catalog.listProposalJudgements(proposal.id);
    const proposalJudgements = await catalog.listJudgements('proposal', proposal.id);
    const fileJudgements = await catalog.listJudgements('file', `${proposal.id}:README.md`);
    const skillJudgements = await catalog.listJudgements('skill', 'catalog-skill:1.0.0');
    const proposalRecord = await catalog.getProposal(proposal.id);
    const history = await catalog.listSkillHistory('catalog-skill');
    const pendingCount = await catalog.countPendingProposals();

    expect(proposalList.total).toBe(2);
    const judgedProposal = proposalList.items.find((item) => item.id === proposal.id);
    expect(judgedProposal?.labels).toContain('safe');
    expect(proposalFiles).toHaveLength(1);
    expect(proposalFiles[0]?.path).toBe('README.md');
    expect(proposalFiles[0]?.sizeBytes).toBe(14);
    expect(allProposalJudgements).toHaveLength(2);
    expect(proposalRecord?.latestJudgementId).toBe('judge-file');
    expect(proposalRecord?.createdAt.toISOString().slice(0, 19)).toBe(proposal.createdAt.toISOString().slice(0, 19));
    expect(proposalJudgements).toHaveLength(1);
    expect(proposalJudgements[0]?.createdAt.toISOString()).toBe('2026-07-02T00:00:00.000Z');
    expect(fileJudgements).toHaveLength(1);
    expect(skillJudgements).toHaveLength(1);
    expect(skillJudgements[0]?.skillId).toBe('catalog-skill');
    expect(skillJudgements[0]?.skillVersion).toBe('1.0.0');
    expect(history).toHaveLength(1);
    expect(history[0]?.action).toBe('publish_skill');
    expect(pendingCount).toBe(1);
  });

  it('maps noop proposal judgements to no_judge_available', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-catalog-mysql-'));
    tempDirs.push(dataDir);
    const catalog = new MysqlSkillCatalog(dataDir, new FakeMysqlClient() as unknown as any);

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
});

function createJudgement(
  id: string,
  targetType: 'proposal' | 'skill' | 'file',
  targetId: string,
  overallRisk: JudgementRisk = JudgementRisk.LOW,
  model: string = 'mysql-catalog'
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
