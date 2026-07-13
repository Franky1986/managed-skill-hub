import { ConflictError, NotFoundError, ValidationError } from '../../../domain/errors';
import { Manifest } from '../../../domain/skill/Manifest';
import { FileRole, ManifestFile } from '../../../domain/skill/ManifestFile';
import { Skill } from '../../../domain/skill/Skill';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import {
  MoveSkillFileDraft,
  SkillCommandPort,
  UpdateSkillDraft,
  UploadSkillFileDraft,
} from '../../ports/inbound/skill-command.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { buildSkillAggregateFromCatalog } from './catalog-skill-hydrator';
import { normalizeRelativeArtifactPath } from '../../../domain/files/relative-artifact-path';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export class UpdateSkillUseCase implements SkillCommandPort {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly audit: AuditLogPort,
    private readonly catalog?: SkillCatalogPort
  ) {}

  async updateSkill(id: string, patch: UpdateSkillDraft, actor: string): Promise<Skill> {
    const skill = await this.loadSkill(id);

    const baseVersion = skill.getAllVersions()[skill.getAllVersions().length - 1];
    if (!baseVersion) {
      throw new ValidationError(`Skill ${id} has no versions`);
    }

    const nextVersion = bumpVersion(baseVersion.version);
    const manifestFiles = await this.copyFilesToNewVersion(skill, baseVersion.version, nextVersion, []);
    const manifest = Manifest.create({
      id,
      title: patch.title ?? baseVersion.manifest.title,
      description: patch.description ?? baseVersion.manifest.description,
      version: nextVersion,
      status: SkillStatus.DRAFT,
      category: patch.category ?? baseVersion.manifest.category,
      tags: patch.tags ?? baseVersion.manifest.tags,
      capabilities: patch.capabilities ?? baseVersion.manifest.capabilities,
      useWhen: baseVersion.manifest.useWhen,
      doNotUseWhen: baseVersion.manifest.doNotUseWhen,
      entrypoint: baseVersion.manifest.entrypoint,
      files: manifestFiles,
    });

    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: nextVersion,
        manifest,
        createdBy: actor,
      })
    );

    await this.repo.save(skill);
    await this.audit.append(
      AuditEntry.create({
        skillId: id,
        skillVersion: nextVersion,
        action: 'update_skill',
        actor,
        before: {
          version: baseVersion.version,
          title: baseVersion.manifest.title,
          category: baseVersion.manifest.category,
        },
        after: {
          id,
          version: nextVersion,
          title: manifest.title,
          category: manifest.category,
        },
      })
    );

    return skill;
  }

  async uploadFile(id: string, version: string, file: UploadSkillFileDraft, actor: string): Promise<Skill> {
    const skill = await this.loadSkill(id);
    const normalizedPath = normalizeRelativeArtifactPath(file.path);
    if (file.content.length > MAX_FILE_SIZE) {
      throw new ValidationError(`File ${normalizedPath} exceeds 5 MB limit`);
    }

    const baseVersion = skill.getVersion(version);
    const nextVersion = bumpVersion(baseVersion.version);
    const manifestFiles = await this.copyFilesToNewVersion(skill, baseVersion.version, nextVersion, [{ ...file, path: normalizedPath }]);
    const manifest = Manifest.create({
      id,
      title: baseVersion.manifest.title,
      description: baseVersion.manifest.description,
      version: nextVersion,
      status: SkillStatus.DRAFT,
      category: baseVersion.manifest.category,
      tags: baseVersion.manifest.tags,
      capabilities: baseVersion.manifest.capabilities,
      useWhen: baseVersion.manifest.useWhen,
      doNotUseWhen: baseVersion.manifest.doNotUseWhen,
      entrypoint: file.role === FileRole.ENTRYPOINT ? normalizedPath : baseVersion.manifest.entrypoint,
      files: manifestFiles,
    });

    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: nextVersion,
        manifest,
        createdBy: actor,
      })
    );

    await this.repo.save(skill);
    await this.audit.append(
      AuditEntry.create({
        skillId: id,
        skillVersion: nextVersion,
        action: 'upload_skill_file',
        actor,
        before: {
          version: baseVersion.version,
        },
        after: {
          id,
          version: nextVersion,
          file: normalizedPath,
          role: file.role ?? 'attachment',
        },
      })
    );

    return skill;
  }

  async moveFile(
    id: string,
    version: string,
    filePath: string,
    patch: MoveSkillFileDraft,
    actor: string
  ): Promise<Skill> {
    const skill = await this.loadSkill(id);

    const baseVersion = skill.getVersion(version);
    const sourceFile = baseVersion.manifest.files.find((candidate) => candidate.path === filePath);
    if (!sourceFile) {
      throw new NotFoundError(`File ${filePath} not found in version ${version}`);
    }

    const targetPath = normalizeRelativeArtifactPath(patch.path, { fieldLabel: 'Target file path' });
    if (targetPath === filePath) {
      throw new ValidationError('Target file path must differ from the current path');
    }
    if (baseVersion.manifest.files.some((candidate) => candidate.path === targetPath)) {
      throw new ConflictError(`File ${targetPath} already exists in version ${version}`);
    }

    const nextVersion = bumpVersion(baseVersion.version);
    const manifestFiles = await this.copyFilesToNewVersion(skill, baseVersion.version, nextVersion, [], {
      relocatedPaths: new Map([[filePath, targetPath]]),
    });
    const manifest = Manifest.create({
      id,
      title: baseVersion.manifest.title,
      description: baseVersion.manifest.description,
      version: nextVersion,
      status: SkillStatus.DRAFT,
      category: baseVersion.manifest.category,
      tags: baseVersion.manifest.tags,
      capabilities: baseVersion.manifest.capabilities,
      useWhen: baseVersion.manifest.useWhen,
      doNotUseWhen: baseVersion.manifest.doNotUseWhen,
      entrypoint: baseVersion.manifest.entrypoint === filePath ? targetPath : baseVersion.manifest.entrypoint,
      files: manifestFiles,
    });

    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: nextVersion,
        manifest,
        createdBy: actor,
      })
    );

    await this.repo.save(skill);
    await this.audit.append(
      AuditEntry.create({
        skillId: id,
        skillVersion: nextVersion,
        action: 'move_skill_file',
        actor,
        before: {
          version: baseVersion.version,
          path: filePath,
        },
        after: {
          id,
          version: nextVersion,
          path: targetPath,
        },
      })
    );

    return skill;
  }

  async deleteFile(id: string, version: string, filePath: string, actor: string): Promise<Skill> {
    const skill = await this.loadSkill(id);

    const baseVersion = skill.getVersion(version);
    const sourceFile = baseVersion.manifest.files.find((candidate) => candidate.path === filePath);
    if (!sourceFile) {
      throw new NotFoundError(`File ${filePath} not found in version ${version}`);
    }
    if (baseVersion.manifest.entrypoint === filePath) {
      throw new ValidationError('Entrypoint file cannot be deleted');
    }

    const nextVersion = bumpVersion(baseVersion.version);
    const manifestFiles = await this.copyFilesToNewVersion(skill, baseVersion.version, nextVersion, [], {
      omittedPaths: new Set([filePath]),
    });
    const manifest = Manifest.create({
      id,
      title: baseVersion.manifest.title,
      description: baseVersion.manifest.description,
      version: nextVersion,
      status: SkillStatus.DRAFT,
      category: baseVersion.manifest.category,
      tags: baseVersion.manifest.tags,
      capabilities: baseVersion.manifest.capabilities,
      useWhen: baseVersion.manifest.useWhen,
      doNotUseWhen: baseVersion.manifest.doNotUseWhen,
      entrypoint: baseVersion.manifest.entrypoint,
      files: manifestFiles,
    });

    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: nextVersion,
        manifest,
        createdBy: actor,
      })
    );

    await this.repo.save(skill);
    await this.audit.append(
      AuditEntry.create({
        skillId: id,
        skillVersion: nextVersion,
        action: 'delete_skill_file',
        actor,
        before: {
          version: baseVersion.version,
          path: filePath,
        },
        after: {
          id,
          version: nextVersion,
          deletedPath: filePath,
        },
      })
    );

    return skill;
  }

  createSkill(): Promise<Skill> {
    throw new Error('not implemented in this use case');
  }
  submitForReview(): Promise<Skill> {
    throw new Error('not implemented in this use case');
  }
  approve(): Promise<Skill> {
    throw new Error('not implemented in this use case');
  }
  publish(): Promise<Skill> {
    throw new Error('not implemented in this use case');
  }
  reject(): Promise<Skill> {
    throw new Error('not implemented in this use case');
  }
  deprecate(): Promise<Skill> {
    throw new Error('not implemented in this use case');
  }

  private async loadSkill(skillId: string): Promise<Skill> {
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

  private async copyFilesToNewVersion(
    skill: Skill,
    sourceVersion: string,
    targetVersion: string,
    overrides: UploadSkillFileDraft[],
    options?: {
      omittedPaths?: Set<string>;
      relocatedPaths?: Map<string, string>;
    }
  ): Promise<ManifestFile[]> {
    const source = skill.getVersion(sourceVersion);
    const storedFiles = await this.storage.listSkillFiles(skill.id.toString(), sourceVersion);
    const copied: ManifestFile[] = [];
    const overridesByPath = new Map(overrides.map((override) => [override.path, override]));
    const omittedPaths = options?.omittedPaths ?? new Set<string>();
    const relocatedPaths = options?.relocatedPaths ?? new Map<string, string>();

    for (const file of storedFiles) {
      const targetPath = relocatedPaths.get(file.path) ?? file.path;
      if (omittedPaths.has(file.path) && !relocatedPaths.has(file.path)) {
        continue;
      }
      if (overridesByPath.has(targetPath)) {
        continue;
      }
      const content = await this.storage.readSkillFile(skill.id.toString(), sourceVersion, file.path);
      if (!content) {
        if (relocatedPaths.has(file.path)) {
          throw new NotFoundError(`File ${file.path} not found in storage`);
        }
        continue;
      }
      const stored = await this.storage.storeSkillFile(
        skill.id.toString(),
        targetVersion,
        targetPath,
        content.content,
        content.mimeType
      );
      const manifestFile = source.manifest.files.find((candidate) => candidate.path === file.path);
      copied.push(
        ManifestFile.create({
          path: stored.path,
          role: manifestFile?.role ?? 'attachment',
          mimeType: stored.mimeType,
          sha256: stored.sha256,
        })
      );
    }

    for (const override of overrides) {
      const existing = source.manifest.files.find((candidate) => candidate.path === override.path);
      const stored = await this.storage.storeSkillFile(
        skill.id.toString(),
        targetVersion,
        override.path,
        override.content,
        override.mimeType
      );
      copied.push(
        ManifestFile.create({
          path: stored.path,
          role: override.role ?? existing?.role ?? FileRole.ATTACHMENT,
          mimeType: stored.mimeType,
          sha256: stored.sha256,
        })
      );
    }

    return copied;
  }
}

function bumpVersion(version: string): string {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join('.');
}
