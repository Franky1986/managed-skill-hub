import { NotFoundError } from '../../../domain/errors';
import { Skill } from '../../../domain/skill/Skill';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { FileScannerPort, ScannedContent } from '../../ports/outbound/file-scanner.port';
import { SkillFileStoragePort, StoredExtractedContent } from '../../ports/outbound/file-storage.port';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { isTextLikeArtifact } from './public-metadata';

export interface ExtractedSkillFileContent {
  text: string;
  extractedBy: string;
  metadata: Record<string, unknown>;
}

export class ExtractSkillFileContentUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly scanner: FileScannerPort,
    private readonly catalog?: SkillCatalogPort
  ) {}

  async execute(
    skillId: string,
    filePath: string,
    options?: { version?: string; includeUnpublished?: boolean; forceRefresh?: boolean }
  ): Promise<ExtractedSkillFileContent> {
    const selectedVersion =
      (await this.resolveCatalogVersion(skillId, options?.version, options?.includeUnpublished ?? false)) ??
      (await this.resolveRepositoryVersion(skillId, options?.version, options?.includeUnpublished ?? false));

    const stored = await this.storage.readSkillFile(skillId, selectedVersion, filePath);
    if (!stored) {
      throw new NotFoundError(`File ${filePath} not found`);
    }

    if (!options?.forceRefresh) {
      const cached = await this.storage.readSkillFileExtract(skillId, selectedVersion, filePath);
      if (cached) {
        return normalizeStoredExtract(cached);
      }
    }

    let extracted: ExtractedSkillFileContent;
    if (isTextLikeArtifact(stored.mimeType, filePath)) {
      extracted = {
        text: stored.content.toString('utf-8'),
        extractedBy: 'native',
        metadata: {
          mimeType: stored.mimeType,
          filePath,
          extractor: 'native',
        },
      };
    } else {
      const scanned = await this.scanner.scan(stored.content, stored.mimeType, filePath);
      extracted = normalizeScannedContent(scanned, stored.mimeType, filePath);
    }

    const persisted = await this.storage.storeSkillFileExtract(skillId, selectedVersion, filePath, extracted);
    return normalizeStoredExtract(persisted);
  }

  private resolveVersion(skill: Skill, version: string | undefined, includeUnpublished: boolean): SkillVersion {
    if (!version) {
      const latest = includeUnpublished
        ? skill.getAllVersions()[skill.getAllVersions().length - 1] ?? null
        : skill.getLatestPublishedVersion();
      if (!latest) {
        throw new NotFoundError(`No matching version found for skill ${skill.id.toString()}`);
      }
      return latest;
    }

    const selected = skill.getVersion(version);
    if (!includeUnpublished && selected.status !== 'published') {
      throw new NotFoundError(`Skill version ${skill.id.toString()}@${version} not found`);
    }
    return selected;
  }

  private async resolveRepositoryVersion(
    skillId: string,
    version: string | undefined,
    includeUnpublished: boolean
  ): Promise<string> {
    const skill = await this.repo.findById(skillId);
    if (!skill) {
      throw new NotFoundError(`Skill ${skillId} not found`);
    }
    return this.resolveVersion(skill, version, includeUnpublished).version;
  }

  private async resolveCatalogVersion(
    skillId: string,
    version: string | undefined,
    includeUnpublished: boolean
  ): Promise<string | null> {
    if (!this.catalog) {
      return null;
    }

    if (!version) {
      const selected = includeUnpublished
        ? await this.catalog.getLatestVersion(skillId)
        : await this.catalog.getLatestPublishedVersion(skillId);
      return selected?.version ?? null;
    }

    const selected = await this.catalog.getSkillVersion(skillId, version);
    if (!selected) {
      return null;
    }
    if (!includeUnpublished && selected.status !== 'published') {
      return null;
    }
    return selected.version;
  }
}

function normalizeStoredExtract(stored: StoredExtractedContent): ExtractedSkillFileContent {
  return {
    text: stored.text,
    extractedBy: stored.extractedBy,
    metadata: {
      ...stored.metadata,
      extractedAt: stored.extractedAt.toISOString(),
    },
  };
}

function normalizeScannedContent(
  scanned: ScannedContent,
  mimeType: string,
  filePath: string
): ExtractedSkillFileContent {
  return {
    text: scanned.text,
    extractedBy: scanned.extractedBy,
    metadata: {
      ...scanned.metadata,
      mimeType,
      filePath,
    },
  };
}
