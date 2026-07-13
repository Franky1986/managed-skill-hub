import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { Manifest } from '../../../domain/skill/Manifest';
import { Skill } from '../../../domain/skill/Skill';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillSearchPort } from '../../ports/outbound/search.port';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import {
  DiscoveryResponse,
  SkillDeprecationInfoDto,
  SkillFileInfo,
  SkillQueryPort,
  SkillSearchQuery,
  SearchResult,
} from '../../ports/inbound/skill-query.port';
import { SkillDetailDto, SkillSummaryDto } from '../../dtos/skill.dto';
import {
  mapCatalogVersionToDetail,
  mapCatalogVersionToSummary,
  mapCatalogVersionToVersionSummary,
  mapSkillToDetail,
  mapSkillToSummary,
  mapSkillVersionToSummary,
} from './mappers/skill.mapper';
import { ManifestFile } from '../../../domain/skill/ManifestFile';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import {
  computeArtifactId,
  computeSkillUuid,
  computeVersionUuid,
  isExtractableArtifact,
} from './public-metadata';
import { buildSkillAggregateFromCatalog } from './catalog-skill-hydrator';

export class SkillQueryAdapter implements SkillQueryPort {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly searchPort: SkillSearchPort,
    private readonly storage: SkillFileStoragePort,
    private readonly audit: AuditLogPort,
    private readonly catalog?: SkillCatalogPort
  ) {}

  async discover(): Promise<DiscoveryResponse> {
    return {
      name: 'managed-skill-hub',
      version: '0.1.0',
      readAuthRequired: false,
      entrypoints: ['/skills', '/skills/search', '/skills/suggest-name', '/categories', '/tags', '/proposals/notice'],
    };
  }

  async listPublished(
    category?: string,
    tags: string[] = [],
    limit = 50,
    offset = 0
  ): Promise<{ items: Skill[]; total: number }> {
    if (this.catalog) {
      const result = await this.catalog.listLatestSkillVersions({
        category,
        publishedOnly: true,
        limit: tags.length > 0 ? 1000 : limit,
        offset: tags.length > 0 ? 0 : offset,
      });
      const items = await Promise.all(
        result.items.map((version) =>
          buildSkillAggregateFromCatalog(this.catalog!, version.skillId, {
            publishedOnly: true,
            preferredPublishedVersion: version.version,
          })
        )
      );
      const filtered = items
        .filter((skill): skill is Skill => skill !== null)
        .filter((skill) => hasAllTags(skill.getLatestPublishedVersion()?.manifest.tags ?? [], tags));
      return {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
      };
    }
    const result = await this.repo.findAll({ category, status: 'published', limit, offset });
    const published = result.items.filter((skill) => skill.getLatestPublishedVersion() !== null);
    const filtered = published.filter((skill) => hasAllTags(skill.getLatestPublishedVersion()?.manifest.tags ?? [], tags));
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  }

  async listPublishedSummaries(
    category?: string,
    tags: string[] = [],
    limit = 50,
    offset = 0
  ): Promise<{ items: SkillSummaryDto[]; total: number }> {
    if (this.catalog) {
      const result = await this.catalog.listLatestSkillVersions({
        category,
        publishedOnly: true,
        limit: tags.length > 0 ? 1000 : limit,
        offset: tags.length > 0 ? 0 : offset,
      });
      const filtered = result.items.filter((version) => hasAllTags(version.tags, tags));
      return {
        items: filtered.slice(offset, offset + limit).map(mapCatalogVersionToSummary),
        total: filtered.length,
      };
    }

    const result = await this.listPublished(category, tags, limit, offset);
    return {
      items: result.items.map(mapSkillToSummary),
      total: result.total,
    };
  }

  async search(query: SkillSearchQuery): Promise<{ items: SearchResult[]; total: number }> {
    const result = await this.searchPort.search(
      query.q,
      query.mode,
      query.category,
      query.tags ?? [],
      query.tags && query.tags.length > 0 ? 1000 : query.limit,
      query.tags && query.tags.length > 0 ? 0 : query.offset,
    );
    const uniqueResults = selectBestSearchResultPerSkill(result.items);
    const items = await Promise.all(
      uniqueResults.slice(query.offset, query.offset + query.limit).map(async (r) => {
        const catalogVersion = this.catalog
          ? ((await this.catalog.getLatestPublishedVersion(r.skillId)) ?? (await this.catalog.getSkillVersion(r.skillId, r.version)))
          : null;
        return {
          id: r.skillId,
          title: catalogVersion?.title ?? r.title,
          description: catalogVersion?.description ?? r.description,
          category: catalogVersion?.category ?? r.groups[0] ?? 'uncategorized',
          tags: catalogVersion?.tags ?? r.groups.slice(1),
          skillUuid: catalogVersion?.skillUuid ?? computeSkillUuid(r.skillId),
          versionUuid: catalogVersion?.versionUuid ?? computeVersionUuid(r.skillId, r.version),
          contentDigest: catalogVersion?.contentDigest ?? '',
          version: catalogVersion?.version ?? r.version,
          publishedAt: catalogVersion?.publishedAt ?? r.publishedAt,
          score: r.score,
        };
      })
    );
    return {
      items,
      total: uniqueResults.length,
    };
  }

  async listCategories(): Promise<string[]> {
    if (this.catalog) {
      return this.catalog.listCategories();
    }
    const result = await this.repo.findAll({ status: 'published' });
    return [
      ...new Set(
        result.items
          .map((skill) => skill.getLatestPublishedVersion()?.manifest.category ?? null)
          .filter((category): category is string => Boolean(category))
      ),
    ].sort((left, right) => left.localeCompare(right));
  }

  async listTags(): Promise<string[]> {
    if (this.catalog) {
      return this.catalog.listTags();
    }
    const result = await this.repo.findAll({ status: 'published' });
    return [
      ...new Set(
        result.items.flatMap((skill) => skill.getLatestPublishedVersion()?.manifest.tags ?? [])
      ),
    ].sort((left, right) => left.localeCompare(right));
  }

  async getSkill(id: string): Promise<Skill | null> {
    if (this.catalog) {
      const latestPublished = await this.catalog.getLatestPublishedVersion(id);
      if (!latestPublished) {
        return null;
      }
      return buildSkillAggregateFromCatalog(this.catalog, id, {
        publishedOnly: true,
        preferredPublishedVersion: latestPublished.version,
      });
    }

    const skill = await this.repo.findById(id);
    if (!skill) {
      return null;
    }
    this.ensureLatestPublished(skill);
    if (!skill.getLatestPublishedVersion()) {
      return null;
    }
    return skill;
  }

  async getSkillDetail(id: string): Promise<SkillDetailDto | null> {
    if (this.catalog) {
      const latestPublished = await this.catalog.getLatestPublishedVersion(id);
      if (!latestPublished) {
        return null;
      }
      const latestVersion = await this.catalog.getLatestVersion(id);
      const versions = await this.catalog.listPublishedVersions(id);
      return mapCatalogVersionToDetail(id, latestPublished, latestVersion, versions);
    }

    const skill = await this.getSkill(id);
    return skill ? mapSkillToDetail(skill) : null;
  }

  async getManifest(skillId: string, version?: string): Promise<Manifest | null> {
    if (this.catalog) {
      const selected = await this.resolvePublishedCatalogVersion(skillId, version);
      if (!selected) {
        return null;
      }
      const files = await this.catalog.listVersionFiles(skillId, selected.version);
      return Manifest.create({
        id: selected.skillId,
        title: selected.title,
        description: selected.description,
        version: selected.version,
        status: selected.status as SkillStatus,
        category: selected.category,
        tags: selected.tags,
        capabilities: selected.capabilities,
        useWhen: selected.useWhen,
        doNotUseWhen: selected.doNotUseWhen,
        entrypoint: selected.entrypoint,
        files: files.map((file) =>
          ManifestFile.create({
            path: file.path,
            role: file.role,
            mimeType: file.mimeType,
            sha256: file.sha256,
          })
        ),
      });
    }

    const skill = await this.getSkill(skillId);
    if (!skill) return null;
    const v = this.resolvePublishedVersion(skill, version);
    return v?.manifest ?? null;
  }

  async listFiles(skillId: string, version?: string): Promise<SkillFileInfo[]> {
    if (this.catalog) {
      const selected = await this.resolvePublishedCatalogVersion(skillId, version);
      if (!selected) {
        return [];
      }
      const files = await this.catalog.listVersionFiles(skillId, selected.version);
      return files.map((file) => ({
        id: file.path,
        artifactId: file.artifactId,
        path: file.path,
        role: file.role,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        updatedAt: file.updatedAt,
        extractable: file.extractable,
      }));
    }

    const skill = await this.getSkill(skillId);
    if (!skill) return [];
    const v = this.resolvePublishedVersion(skill, version);
    if (!v) return [];
    const stored = await this.storage.listSkillFiles(skillId, v.version);
    const manifestFiles = v.manifest.files;
    return stored.map((s) => {
      const mf = manifestFiles.find((m) => m.path === s.path);
      return {
        id: s.path,
        artifactId: computeArtifactId(skillId, v.version, s.path),
        path: s.path,
        role: mf?.role ?? 'attachment',
        mimeType: s.mimeType,
        sizeBytes: s.sizeBytes,
        sha256: s.sha256,
        updatedAt: s.updatedAt,
        extractable: isExtractableArtifact(s.mimeType, s.path),
      };
    });
  }

  async getFile(
    skillId: string,
    fileId: string,
    version?: string
  ): Promise<{ path: string; mimeType: string; content: Buffer } | null> {
    const selectedVersion = this.catalog
      ? await this.resolvePublishedCatalogVersion(skillId, version)
      : null;
    if (this.catalog && !selectedVersion) {
      return null;
    }

    const skill = selectedVersion ? null : await this.getSkill(skillId);
    if (!selectedVersion && !skill) return null;

    const publishedVersion = selectedVersion ? null : this.resolvePublishedVersion(skill as Skill, version);
    const resolvedVersion = selectedVersion?.version ?? publishedVersion?.version;
    if (!resolvedVersion) return null;

    const publishedFiles = this.catalog
      ? await this.catalog.listVersionFiles(skillId, resolvedVersion)
      : publishedVersion?.manifest.files ?? [];
    if (!publishedFiles.some((file) => file.path === fileId)) return null;

    const file = await this.storage.readSkillFile(skillId, resolvedVersion, fileId);
    if (!file) return null;
    return { path: fileId, mimeType: file.mimeType, content: file.content };
  }

  async listVersions(skillId: string) {
    if (this.catalog) {
      const versions = await this.catalog.listPublishedVersions(skillId);
      return versions.map(mapCatalogVersionToVersionSummary);
    }

    const skill = await this.getSkill(skillId);
    return skill?.getPublishedVersions().map(mapSkillVersionToSummary) ?? [];
  }

  async getHistory(skillId: string): Promise<AuditEntry[]> {
    if (this.catalog) {
      const publishedVersions = new Set(
        (await this.catalog.listPublishedVersions(skillId)).map((version) => version.version)
      );
      if (publishedVersions.size === 0) {
        return [];
      }
      const history = await this.catalog.listSkillHistory(skillId);
      return history
        .filter((entry) => entry.skillVersion === null || publishedVersions.has(entry.skillVersion))
        .map((entry) =>
          AuditEntry.create({
            id: entry.id,
            skillId: entry.skillId,
            skillVersion: entry.skillVersion,
            proposalId: entry.proposalId,
            action: entry.action,
            actor: entry.actor,
            before: entry.before,
            after: entry.after,
            createdAt: entry.createdAt,
          })
        );
    }

    const skill = await this.getSkill(skillId);
    if (!skill) {
      return [];
    }
    const publishedVersions = new Set(skill.getPublishedVersions().map((version) => version.version));
    const history = await this.audit.findBySkillId(skillId);
    return history.filter((entry) => entry.skillVersion === null || publishedVersions.has(entry.skillVersion));
  }

  async getDeprecationInfo(skillId: string, version?: string): Promise<SkillDeprecationInfoDto | null> {
    if (this.catalog) {
      const selected = version
        ? await this.catalog.getSkillVersion(skillId, version)
        : await this.catalog.getLatestPublishedVersion(skillId);
      if (!selected || selected.status !== 'published') {
        return null;
      }
      return {
        skillId: selected.skillId,
        version: selected.version,
        status: selected.status,
        deprecatedBy: selected.deprecatedBy,
        deprecatedAt: selected.deprecatedAt,
        reason: selected.deprecationReason,
      };
    }

    const skill = await this.getSkill(skillId);
    if (!skill) {
      return null;
    }
    const v = this.resolvePublishedVersion(skill, version);
    if (!v) {
      return null;
    }
    return {
      skillId,
      version: v.version,
      status: v.status,
      deprecatedBy: v.deprecatedBy,
      deprecatedAt: v.deprecatedAt,
      reason: v.deprecationReason,
    };
  }

  private resolvePublishedVersion(skill: Skill, version?: string): SkillVersion | null {
    if (!version) {
      return skill.getLatestPublishedVersion();
    }
    try {
      const selected = skill.getVersion(version);
      return selected.status === 'published' ? selected : null;
    } catch {
      return null;
    }
  }

  private ensureLatestPublished(skill: Skill, preferredVersion?: string): void {
    const current = skill.getLatestPublishedVersion();
    if (current) {
      return;
    }

    if (preferredVersion) {
      try {
        skill.setLatestPublished(preferredVersion);
        return;
      } catch {
        // Fall back to derived latest published version below.
      }
    }

    const published = [...skill.getPublishedVersions()].sort((left, right) =>
      compareVersions(left.version, right.version)
    );
    const latest = published[published.length - 1];
    if (latest) {
      skill.setLatestPublished(latest.version);
    }
  }

  private async resolvePublishedCatalogVersion(skillId: string, version?: string) {
    if (!this.catalog) {
      return null;
    }
    if (!version) {
      return this.catalog.getLatestPublishedVersion(skillId);
    }
    const selected = await this.catalog.getSkillVersion(skillId, version);
    return selected?.status === 'published' ? selected : null;
  }

}

function hasAllTags(candidateTags: string[], expectedTags: string[]): boolean {
  if (expectedTags.length === 0) {
    return true;
  }
  const normalized = new Set(candidateTags.map((tag) => tag.toLowerCase()));
  return expectedTags.every((tag) => normalized.has(tag.toLowerCase()));
}

function selectBestSearchResultPerSkill<T extends { skillId: string; score: number | null }>(results: T[]): T[] {
  const bestBySkill = new Map<string, T>();
  for (const result of results) {
    const current = bestBySkill.get(result.skillId);
    if (!current || compareSearchScore(result.score, current.score) > 0) {
      bestBySkill.set(result.skillId, result);
    }
  }
  return [...bestBySkill.values()];
}

function compareSearchScore(left: number | null, right: number | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return -1;
  }
  if (right === null) {
    return 1;
  }
  return left - right;
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
