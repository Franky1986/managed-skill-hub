import { computeContentDigest, computeSkillUuid, computeVersionUuid } from './public-metadata';
import { Manifest } from '../../../domain/skill/Manifest';
import { SkillFileInfo } from '../../ports/inbound/skill-query.port';

export const USE_SKILL_HUB_SKILL_ID = 'use-skill-hub';
export const USE_SKILL_HUB_INITIAL_VERSION = '0.0.0-initial';
export const SKILL_HUB_META_FILENAME = 'skill-hub-meta.json';
export const SYSTEM_MANAGED_CATEGORY = 'registry-system';
export const SYSTEM_MANAGED_TAG = 'system-managed';
export const SKILL_HUB_META_SCHEMA = 'managed-skill-hub.skill-meta.v1';

export interface SkillHubMetaInput {
  registryId: string;
  registryName: string;
  apiBaseUrl: string;
  manifest: Manifest;
  files: SkillFileInfo[];
  fallback: boolean;
  downloadedAt: Date;
  publishedAt: Date | null;
}

export function isReservedSkillHubMetaPath(filePath: string): boolean {
  const basename = filePath.replace(/\\/g, '/').split('/').at(-1)?.trim().toLowerCase();
  return basename === SKILL_HUB_META_FILENAME;
}

function deriveSkillIdCandidate(value: string | null | undefined): string | null {
  const candidate = value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return candidate || null;
}

export function isSystemManagedSkillCandidate(input: {
  skillId?: string | null;
  title?: string | null;
  category?: string | null;
  tags?: string[] | null;
}): boolean {
  const targetSkillId = input.skillId?.trim().toLowerCase() ?? deriveSkillIdCandidate(input.title);
  return (
    targetSkillId === USE_SKILL_HUB_SKILL_ID ||
    input.category?.trim().toLowerCase() === SYSTEM_MANAGED_CATEGORY ||
    (input.tags ?? []).some((tag) => tag.trim().toLowerCase() === SYSTEM_MANAGED_TAG)
  );
}

export function buildSkillHubMeta(input: SkillHubMetaInput): Record<string, unknown> {
  const apiBaseUrl = input.apiBaseUrl.replace(/\/+$/, '');
  const version = input.manifest.version;
  const skillId = input.manifest.id;
  const versionQuery = `version=${encodeURIComponent(version)}`;
  const contentDigest = computeContentDigest(
    skillId,
    version,
    input.manifest.category,
    input.manifest.tags,
    input.manifest.capabilities,
    input.manifest.entrypoint,
    input.files.map((file) => ({
      path: file.path,
      role: file.role,
      mimeType: file.mimeType,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      updatedAt: file.updatedAt,
    }))
  );

  return {
    schema: SKILL_HUB_META_SCHEMA,
    downloadedAt: input.downloadedAt.toISOString(),
    registry: {
      id: input.registryId,
      name: input.registryName,
      apiBaseUrl,
    },
    skill: {
      id: skillId,
      title: input.manifest.title,
      description: input.manifest.description,
      category: input.manifest.category,
      tags: input.manifest.tags,
      capabilities: input.manifest.capabilities,
      entrypoint: input.manifest.entrypoint,
      skillUuid: computeSkillUuid(skillId),
    },
    version: {
      version,
      versionUuid: computeVersionUuid(skillId, version),
      contentDigest,
      publishedAt: input.publishedAt ? input.publishedAt.toISOString() : null,
      fallback: input.fallback,
    },
    links: {
      discover: `${apiBaseUrl}/discover`,
      howToPropose: `${apiBaseUrl}/howToPropose`,
      skill: `${apiBaseUrl}/skills/${encodeURIComponent(skillId)}`,
      manifest: `${apiBaseUrl}/skills/${encodeURIComponent(skillId)}/manifest?${versionQuery}`,
      versions: `${apiBaseUrl}/skills/${encodeURIComponent(skillId)}/versions`,
      package: `${apiBaseUrl}/skills/${encodeURIComponent(skillId)}/package?${versionQuery}`,
      readEntrypoint:
        `${apiBaseUrl}/skills/${encodeURIComponent(skillId)}/files/${encodeURIComponent(input.manifest.entrypoint)}?${versionQuery}`,
      proposals: `${apiBaseUrl}/proposals`,
    },
    proposalDefaults: {
      targetSkillId: skillId,
      resolution: 'create_new_version',
      entrypoint: input.manifest.entrypoint,
      metadataSource: SKILL_HUB_META_FILENAME,
      excludeFromProposal: [SKILL_HUB_META_FILENAME],
    },
    localUpdatePolicy: {
      backupDirectory: 'backups',
      localEditMarker: 'edited_locally',
      requiresUserConfirmationBeforeReplace: true,
      instruction:
        'Before replacing local files, compare local changes, create a backup inside the skill folder, and ask the user.',
    },
  };
}

export function buildSkillHubMetaBuffer(input: SkillHubMetaInput): Buffer {
  return Buffer.from(JSON.stringify(buildSkillHubMeta(input), null, 2) + '\n', 'utf-8');
}
