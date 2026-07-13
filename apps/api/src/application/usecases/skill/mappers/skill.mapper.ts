import { SkillStatus } from '../../../../domain/skill/SkillStatus';
import { Skill } from '../../../../domain/skill/Skill';
import { SkillVersion } from '../../../../domain/skill/SkillVersion';
import {
  SkillSummaryDto,
  SkillDetailDto,
  SkillVersionSummaryDto,
} from '../../../dtos/skill.dto';
import { CatalogSkillVersionRecord } from '../../../ports/outbound/skill-catalog.port';
import {
  computeContentDigestForVersion,
  computeSkillUuid,
  computeVersionUuid,
} from '../public-metadata';

export function mapSkillToSummary(skill: Skill): SkillSummaryDto {
  const published = skill.getLatestPublishedVersion();
  const fallback = skill.getAllVersions()[0];
  const selected = published ?? fallback;
  return {
    id: skill.id.toString(),
    title: published?.manifest.title ?? fallback?.manifest.title ?? skill.id.toString(),
    description: published?.manifest.description ?? fallback?.manifest.description ?? '',
    category: selected?.manifest.category ?? 'uncategorized',
    tags: selected?.manifest.tags ?? [],
    skillUuid: computeSkillUuid(skill.id.toString()),
    versionUuid: selected ? computeVersionUuid(skill.id.toString(), selected.version) : '',
    contentDigest: selected ? computeContentDigestForVersion(selected) : '',
    version: selected?.version ?? 'unknown',
    status: selected?.status ?? SkillStatus.DRAFT,
    publishedAt: published?.publishedAt ?? null,
  };
}

export function mapSkillToAdminSummary(skill: Skill): SkillSummaryDto {
  const latest = skill.getAllVersions()[skill.getAllVersions().length - 1];
  const published = skill.getLatestPublishedVersion();
  const selected = latest ?? published;
  return {
    id: skill.id.toString(),
    title: selected?.manifest.title ?? skill.id.toString(),
    description: selected?.manifest.description ?? '',
    category: selected?.manifest.category ?? 'uncategorized',
    tags: selected?.manifest.tags ?? [],
    skillUuid: computeSkillUuid(skill.id.toString()),
    versionUuid: selected ? computeVersionUuid(skill.id.toString(), selected.version) : '',
    contentDigest: selected ? computeContentDigestForVersion(selected) : '',
    version: selected?.version ?? 'unknown',
    status: selected?.status ?? SkillStatus.DRAFT,
    publishedAt: published?.publishedAt ?? null,
  };
}

export function mapCatalogVersionToSummary(version: CatalogSkillVersionRecord): SkillSummaryDto {
  return {
    id: version.skillId,
    title: version.title,
    description: version.description,
    category: version.category,
    tags: version.tags,
    skillUuid: version.skillUuid,
    versionUuid: version.versionUuid,
    contentDigest: version.contentDigest,
    version: version.version,
    status: version.status as SkillStatus,
    publishedAt: version.publishedAt,
  };
}

export function mapCatalogVersionToDetail(
  skillId: string,
  latestPublishedVersion: CatalogSkillVersionRecord | null,
  latestVersion: CatalogSkillVersionRecord | null,
  versions: CatalogSkillVersionRecord[]
): SkillDetailDto {
  const selected = latestPublishedVersion ?? latestVersion;
  return {
    id: skillId,
    title: selected?.title ?? skillId,
    description: selected?.description ?? '',
    category: selected?.category ?? 'uncategorized',
    tags: selected?.tags ?? [],
    capabilities: selected?.capabilities ?? [],
    useWhen: selected?.useWhen ?? [],
    doNotUseWhen: selected?.doNotUseWhen ?? [],
    entrypoint: selected?.entrypoint ?? 'README.md',
    skillUuid: selected?.skillUuid ?? computeSkillUuid(skillId),
    latestPublishedVersion: latestPublishedVersion?.version ?? null,
    versions: versions.map(mapCatalogVersionToVersionSummary),
  };
}

export function mapSkillToDetail(skill: Skill): SkillDetailDto {
  return mapSkillToDetailWithVersions(skill, skill.getPublishedVersions());
}

export function mapSkillToAdminDetail(skill: Skill): SkillDetailDto {
  return mapSkillToDetailWithVersions(skill, skill.getAllVersions());
}

function mapSkillToDetailWithVersions(skill: Skill, versions: SkillVersion[]): SkillDetailDto {
  const published = skill.getLatestPublishedVersion();
  const latestVersion = skill.getAllVersions()[skill.getAllVersions().length - 1];
  return {
    id: skill.id.toString(),
    title: published?.manifest.title ?? latestVersion?.manifest.title ?? skill.id.toString(),
    description: published?.manifest.description ?? latestVersion?.manifest.description ?? '',
    category: published?.manifest.category ?? latestVersion?.manifest.category ?? 'uncategorized',
    tags: published?.manifest.tags ?? latestVersion?.manifest.tags ?? [],
    capabilities: published?.manifest.capabilities ?? latestVersion?.manifest.capabilities ?? [],
    useWhen: published?.manifest.useWhen ?? latestVersion?.manifest.useWhen ?? [],
    doNotUseWhen: published?.manifest.doNotUseWhen ?? latestVersion?.manifest.doNotUseWhen ?? [],
    entrypoint: published?.manifest.entrypoint ?? latestVersion?.manifest.entrypoint ?? 'README.md',
    skillUuid: computeSkillUuid(skill.id.toString()),
    latestPublishedVersion: published?.version ?? null,
    versions: versions.map(mapSkillVersionToSummary),
  };
}

export function mapSkillVersionToSummary(version: SkillVersion): SkillVersionSummaryDto {
  return {
    version: version.version,
    versionUuid: computeVersionUuid(version.skillId.toString(), version.version),
    contentDigest: computeContentDigestForVersion(version),
    status: version.status,
    createdAt: version.createdAt,
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt,
    publishedBy: version.publishedBy,
    publishedAt: version.publishedAt,
    rejectedBy: version.rejectedBy,
    rejectedAt: version.rejectedAt,
    rejectionReason: version.rejectionReason,
    deprecatedBy: version.deprecatedBy,
    deprecatedAt: version.deprecatedAt,
    deprecationReason: version.deprecationReason,
  };
}

export function mapCatalogVersionToVersionSummary(version: CatalogSkillVersionRecord): SkillVersionSummaryDto {
  return {
    version: version.version,
    versionUuid: version.versionUuid,
    contentDigest: version.contentDigest,
    status: version.status as SkillStatus,
    createdAt: version.createdAt,
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt,
    publishedBy: version.publishedBy,
    publishedAt: version.publishedAt,
    rejectedBy: version.rejectedBy,
    rejectedAt: version.rejectedAt,
    rejectionReason: version.rejectionReason,
    deprecatedBy: version.deprecatedBy,
    deprecatedAt: version.deprecatedAt,
    deprecationReason: version.deprecationReason,
  };
}
