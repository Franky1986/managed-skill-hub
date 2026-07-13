import { NotFoundError } from '../../../domain/errors';
import { Skill } from '../../../domain/skill/Skill';
import { SkillCommandPort } from '../../ports/inbound/skill-command.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SkillSearchPort } from '../../ports/outbound/search.port';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { SkillJudgerPort } from '../../ports/outbound/judger.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { isExtractableArtifact, isTextLikeArtifact } from './public-metadata';
import { buildSkillAggregateFromCatalog } from './catalog-skill-hydrator';

export class ReviewSkillUseCase implements SkillCommandPort {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly audit: AuditLogPort,
    private readonly storage: SkillFileStoragePort,
    private readonly scanner: FileScannerPort,
    private readonly search: SkillSearchPort,
    private readonly catalog?: SkillCatalogPort,
    private readonly judger?: SkillJudgerPort
  ) {}

  async submitForReview(id: string, version: string, actor: string): Promise<Skill> {
    const skill = await this.loadSkill(id);
    const { skill: updated, entry } = skill.submitForReview(version, actor);
    await this.repo.save(updated);
    await this.audit.append(entry);
    return updated;
  }

  async approve(id: string, version: string, actor: string): Promise<Skill> {
    const skill = await this.loadSkill(id);
    const { skill: updated, entry } = skill.approveVersion(version, actor);
    await this.repo.save(updated);
    await this.audit.append(entry);
    return updated;
  }

  async publish(id: string, version: string, actor: string): Promise<Skill> {
    const skill = await this.loadSkill(id);
    const previousPublishedVersion = skill.getLatestPublishedVersion()?.version ?? null;
    const { skill: updated, entry } = skill.publishVersion(version, actor);
    await this.repo.save(updated);
    await this.audit.append(entry);
    const publishedVersion = updated.getVersion(version);
    const newBody = await this.buildExtractedBody(id, version);
    await this.search.indexVersion(publishedVersion, newBody);
    const changeSummary = await this.buildPublishChangeSummary(id, previousPublishedVersion, version, newBody);
    await this.audit.append(
      AuditEntry.create({
        skillId: id,
        skillVersion: version,
        action: 'publish_change_note',
        actor,
        before: { previousPublishedVersion },
        after: {
          previousPublishedVersion,
          newPublishedVersion: version,
          changeSummary,
        },
      })
    );
    return updated;
  }

  async reject(id: string, version: string, actor: string, reason: string): Promise<Skill> {
    const skill = await this.loadSkill(id);
    const { skill: updated, entry } = skill.rejectVersion(version, actor, reason);
    await this.repo.save(updated);
    await this.audit.append(entry);
    return updated;
  }

  async deprecate(id: string, version: string, actor: string, reason?: string | null): Promise<Skill> {
    const skill = await this.loadSkill(id);
    const { skill: updated, entry } = skill.deprecateVersion(version, actor, reason);
    await this.repo.save(updated);
    await this.audit.append(entry);
    await this.search.removeVersion(id, version);
    return updated;
  }

  createSkill(): Promise<Skill> {
    throw new Error('not implemented in this use case');
  }
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

  private async buildExtractedBody(skillId: string, version: string): Promise<string> {
    const files = await this.storage.listSkillFiles(skillId, version);
    const chunks: string[] = [];

    for (const file of files) {
      if (!isExtractableArtifact(file.mimeType, file.path)) {
        continue;
      }

      const stored = await this.storage.readSkillFile(skillId, version, file.path);
      if (!stored) {
        continue;
      }

      if (isTextLikeArtifact(stored.mimeType, file.path)) {
        chunks.push(stored.content.toString('utf-8'));
        continue;
      }

      try {
        const scanned = await this.scanner.scan(stored.content, stored.mimeType, file.path);
        chunks.push(scanned.text);
      } catch {
        // Ignore extraction failures so publishing still succeeds.
      }
    }

    return chunks.join('\n\n');
  }

  private async buildPublishChangeSummary(
    skillId: string,
    previousPublishedVersion: string | null,
    newPublishedVersion: string,
    newBody: string
  ): Promise<string> {
    const previousBody = previousPublishedVersion
      ? await this.buildExtractedBody(skillId, previousPublishedVersion)
      : '';

    if (!this.judger) {
      return previousPublishedVersion
        ? `Published ${newPublishedVersion}, replacing ${previousPublishedVersion}.`
        : `Published initial version ${newPublishedVersion}.`;
    }

    try {
      const judgement = await this.judger.judge({
        type: 'skill',
        id: `${skillId}:${newPublishedVersion}:change-note`,
        title: `Change note for ${skillId} ${newPublishedVersion}`,
        text: [
          'Create a concise change note for publishing this skill version.',
          `Previous published version: ${previousPublishedVersion ?? 'none'}`,
          `New published version: ${newPublishedVersion}`,
          'Previous content:',
          previousBody || '[none]',
          'New content:',
          newBody || '[empty]',
        ].join('\n\n'),
        metadata: {
          skillId,
          previousPublishedVersion,
          newPublishedVersion,
          outputIntent: 'release-change-note',
        },
      });
      return judgement.summary || (
        previousPublishedVersion
          ? `Published ${newPublishedVersion}, replacing ${previousPublishedVersion}.`
          : `Published initial version ${newPublishedVersion}.`
      );
    } catch {
      return previousPublishedVersion
        ? `Published ${newPublishedVersion}, replacing ${previousPublishedVersion}.`
        : `Published initial version ${newPublishedVersion}.`;
    }
  }
}
