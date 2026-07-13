import { NotFoundError } from '../../../domain/errors';
import { Skill } from '../../../domain/skill/Skill';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { SkillDetailDto, SkillSummaryDto } from '../../dtos/skill.dto';
import { SkillFileInfo } from '../../ports/inbound/skill-query.port';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { mapCatalogVersionToDetail, mapCatalogVersionToSummary, mapSkillToAdminDetail, mapSkillToAdminSummary } from './mappers/skill.mapper';
import {
  computeArtifactId,
  isExtractableArtifact,
} from './public-metadata';
import {
  ExtractedSkillFileContent,
  ExtractSkillFileContentUseCase,
} from './extract-skill-file-content.usecase';
import { buildSkillAggregateFromCatalog } from './catalog-skill-hydrator';

export class AdminSkillReadUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly extractor: ExtractSkillFileContentUseCase,
    private readonly catalog?: SkillCatalogPort
  ) {}

  async listSkillSummaries(): Promise<{ items: SkillSummaryDto[]; total: number }> {
    if (this.catalog) {
      const result = await this.catalog.listLatestSkillVersions();
      return {
        items: result.items.map(mapCatalogVersionToSummary),
        total: result.total,
      };
    }

    const result = await this.repo.findAll();
    return {
      items: result.items.map(mapSkillToAdminSummary),
      total: result.total,
    };
  }

  async getSkillDetail(skillId: string): Promise<SkillDetailDto> {
    if (this.catalog) {
      const latestVersion = await this.catalog.getLatestVersion(skillId);
      if (!latestVersion) {
        throw new NotFoundError(`Skill ${skillId} not found`);
      }
      const latestPublishedVersion = await this.catalog.getLatestPublishedVersion(skillId);
      const versions = await this.catalog.listSkillVersions(skillId);
      return mapCatalogVersionToDetail(skillId, latestPublishedVersion, latestVersion, versions);
    }

    return mapSkillToAdminDetail(await this.getSkill(skillId));
  }

  async getSkill(skillId: string): Promise<Skill> {
    if (this.catalog) {
      const skill = await buildSkillAggregateFromCatalog(this.catalog, skillId);
      if (skill) {
        return skill;
      }
    }

    const skill = await this.repo.findById(skillId);
    if (!skill) {
      throw new NotFoundError(`Skill ${skillId} not found`);
    }
    return skill;
  }

  async listFiles(skillId: string, version?: string): Promise<SkillFileInfo[]> {
    if (this.catalog) {
      const selected = await this.resolveCatalogVersion(skillId, version);
      if (selected) {
        const [catalogFiles, storedFiles] = await Promise.all([
          this.catalog.listVersionFiles(skillId, selected.version),
          this.storage.listSkillFiles(skillId, selected.version),
        ]);
        const catalogFileIndex = new Map(
          catalogFiles.map((file) => [file.path, file])
        );
        const storedFileIndex = new Map(
          storedFiles.map((file) => [file.path, file])
        );
        const allPaths = Array.from(new Set([
          ...catalogFiles.map((file) => file.path),
          ...storedFiles.map((file) => file.path),
        ]));
        const mergedFiles = allPaths
          .map((path) => {
            const file = storedFileIndex.get(path);
            const catalogFile = catalogFileIndex.get(path);
            const mimeType = catalogFile?.mimeType ?? file?.mimeType ?? 'application/octet-stream';
            return {
              id: path,
              artifactId: catalogFile?.artifactId ?? computeArtifactId(skillId, selected.version, path),
              path,
              role: catalogFile?.role ?? 'attachment',
              mimeType,
              sizeBytes: file?.sizeBytes ?? catalogFile?.sizeBytes ?? 0,
              sha256: file?.sha256 ?? catalogFile?.sha256 ?? null,
              updatedAt: file?.updatedAt ?? catalogFile?.updatedAt ?? null,
              extractable: catalogFile?.extractable ?? isExtractableArtifact(mimeType, path),
            } satisfies SkillFileInfo;
          })
          .sort((a, b) => a.path.localeCompare(b.path));
        return mergedFiles;
      }
    }

    const skill = await this.getSkill(skillId);
    const selected = this.resolveVersion(skill, version);
    const storedFiles = await this.storage.listSkillFiles(skillId, selected.version);

    return storedFiles.map((file) => {
      const manifestFile = selected.manifest.files.find((candidate) => candidate.path === file.path);
      const mimeType = manifestFile?.mimeType ?? file.mimeType;
      return {
        id: file.path,
        artifactId: computeArtifactId(skillId, selected.version, file.path),
        path: file.path,
        role: manifestFile?.role ?? 'attachment',
        mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        updatedAt: file.updatedAt,
        extractable: isExtractableArtifact(mimeType, file.path),
      };
    });
  }

  async getFile(
    skillId: string,
    filePath: string,
    version?: string
  ): Promise<{ path: string; mimeType: string; content: Buffer }> {
    const selectedCatalogVersion = this.catalog
      ? await this.resolveCatalogVersion(skillId, version)
      : null;
    const selectedVersion = selectedCatalogVersion?.version ?? this.resolveVersion(await this.getSkill(skillId), version).version;
    const file = await this.storage.readSkillFile(skillId, selectedVersion, filePath);
    if (!file) {
      throw new NotFoundError(`File ${filePath} not found`);
    }
    return {
      path: filePath,
      mimeType: file.mimeType,
      content: file.content,
    };
  }

  async getExtractedContent(
    skillId: string,
    filePath: string,
    version?: string
  ): Promise<ExtractedSkillFileContent> {
    return this.extractor.execute(skillId, filePath, {
      version,
      includeUnpublished: true,
    });
  }

  private resolveVersion(skill: Skill, version?: string): SkillVersion {
    if (version) {
      return skill.getVersion(version);
    }
    const latest = skill.getAllVersions()[skill.getAllVersions().length - 1];
    if (!latest) {
      throw new NotFoundError(`Skill ${skill.id.toString()} has no versions`);
    }
    return latest;
  }

  private async resolveCatalogVersion(skillId: string, version?: string) {
    if (!this.catalog) {
      return null;
    }
    if (version) {
      return this.catalog.getSkillVersion(skillId, version);
    }
    return this.catalog.getLatestVersion(skillId);
  }
}
