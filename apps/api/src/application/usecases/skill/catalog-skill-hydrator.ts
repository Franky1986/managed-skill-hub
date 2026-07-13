import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { Manifest } from '../../../domain/skill/Manifest';
import { ManifestFile } from '../../../domain/skill/ManifestFile';
import { Skill } from '../../../domain/skill/Skill';
import { SkillId } from '../../../domain/skill/SkillId';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import { SkillVersion } from '../../../domain/skill/SkillVersion';

export async function buildSkillAggregateFromCatalog(
  catalog: SkillCatalogPort,
  skillId: string,
  options?: { publishedOnly?: boolean; preferredPublishedVersion?: string | null }
): Promise<Skill | null> {
  const versions = options?.publishedOnly
    ? await catalog.listPublishedVersions(skillId)
    : await catalog.listSkillVersions(skillId);

  if (versions.length === 0) {
    return null;
  }

  const firstVersion = versions[0]!;
  const skill = Skill.create({
    id: SkillId.create(skillId),
    createdBy: firstVersion.publishedBy ?? firstVersion.approvedBy ?? 'catalog',
    createdAt: firstVersion.createdAt,
  });

  for (const version of versions) {
    const files = await catalog.listVersionFiles(skillId, version.version);
    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: version.version,
        contentHash: version.contentDigest,
        createdBy: version.publishedBy ?? version.approvedBy ?? 'catalog',
        createdAt: version.createdAt,
        manifest: Manifest.create({
          id: version.skillId,
          title: version.title,
          description: version.description,
          version: version.version,
          status: version.status as SkillStatus,
          category: version.category,
          tags: version.tags,
          capabilities: version.capabilities,
          useWhen: version.useWhen,
          doNotUseWhen: version.doNotUseWhen,
          entrypoint: version.entrypoint,
          files: files.map((file) =>
            ManifestFile.create({
              path: file.path,
              role: file.role,
              mimeType: file.mimeType,
              sha256: file.sha256,
            })
          ),
        }),
      })
    );
  }

  const latestPublishedVersion =
    options?.preferredPublishedVersion ??
    [...versions].reverse().find((version) => version.status === SkillStatus.PUBLISHED)?.version ??
    null;

  if (latestPublishedVersion) {
    skill.setLatestPublished(latestPublishedVersion);
  }

  return skill;
}
