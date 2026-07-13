import { SkillId } from '../../../domain/skill/SkillId';
import { Manifest } from '../../../domain/skill/Manifest';
import { ManifestFile, FileRole } from '../../../domain/skill/ManifestFile';
import { Skill } from '../../../domain/skill/Skill';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { SkillCommandPort, CreateSkillDraft } from '../../ports/inbound/skill-command.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { ValidationError } from '../../../domain/errors';
import { normalizeRelativeArtifactPath } from '../../../domain/files/relative-artifact-path';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export class CreateSkillUseCase implements SkillCommandPort {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly audit: AuditLogPort
  ) {}

  async createSkill(draft: CreateSkillDraft, actor: string): Promise<Skill> {
    const id = SkillId.create(draft.id);
    const exists = await this.repo.exists(id.toString());
    if (exists) {
      throw new ValidationError(`Skill ${draft.id} already exists`);
    }

    const skill = Skill.create({ id, createdBy: actor });
    const version = '1.0.0';

    const manifestFiles: ManifestFile[] = [];
    if (draft.files) {
      for (const file of draft.files) {
        const normalizedPath = normalizeRelativeArtifactPath(file.path);
        if (file.content.length > MAX_FILE_SIZE) {
          throw new ValidationError(`File ${normalizedPath} exceeds 5 MB limit`);
        }
        const stored = await this.storage.storeSkillFile(
          id.toString(),
          version,
          normalizedPath,
          file.content,
          file.mimeType
        );
        manifestFiles.push(
          ManifestFile.create({
            path: stored.path,
            role: file.role ?? FileRole.ATTACHMENT,
            mimeType: stored.mimeType,
            sha256: stored.sha256,
          })
        );
      }
    }

    const manifest = Manifest.create({
      id: id.toString(),
      title: draft.title,
      description: draft.description,
      version,
      status: SkillStatus.DRAFT,
      category: draft.category,
      tags: draft.tags,
      capabilities: draft.capabilities,
      entrypoint: draft.entrypoint,
      files: manifestFiles,
    });

    const skillVersion = SkillVersion.create({
      skillId: id,
      version,
      manifest,
      createdBy: actor,
    });

    skill.addVersion(skillVersion);
    await this.repo.save(skill);
    await this.audit.append(
      AuditEntry.create({
        skillId: id.toString(),
        skillVersion: version,
        action: 'create_skill',
        actor,
        after: { id: id.toString(), version, title: draft.title },
      })
    );

    return skill;
  }

  // placeholder implementations for interface compliance
  updateSkill(): Promise<Skill> {
    throw new Error('not implemented in this use case');
  }
  uploadFile(): Promise<Skill> {
    throw new Error('not implemented in this use case');
  }
  moveFile(): Promise<Skill> {
    throw new Error('not implemented in this use case');
  }
  deleteFile(): Promise<Skill> {
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
}
