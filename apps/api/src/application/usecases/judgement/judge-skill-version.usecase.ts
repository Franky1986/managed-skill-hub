import { NotFoundError } from '../../../domain/errors';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillJudgerPort } from '../../ports/outbound/judger.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { CatalogSkillVersionRecord, SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { isTextLikeArtifact } from '../skill/public-metadata';
import { JudgementRuntimeEventSink, judgementErrorCategory } from './judgement-runtime-event';

const MAX_SKILL_FILE_TEXT_CHARS = 8000;

export class JudgeSkillVersionUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly judger: SkillJudgerPort,
    private readonly audit: AuditLogPort,
    private readonly catalog?: SkillCatalogPort,
    private readonly storage?: SkillFileStoragePort,
    private readonly scanner?: FileScannerPort,
    private readonly judgementEvents?: JudgementRuntimeEventSink
  ) {}

  async execute(
    skillId: string,
    version: string,
    options: {
      contextText?: string;
      contextMetadata?: Record<string, unknown>;
      actor?: string;
    } = {}
  ) {
    const target = (await this.resolveCatalogTarget(skillId, version)) ?? (await this.resolveRepositoryTarget(skillId, version));

    const mergedMetadata = {
      ...target.metadata,
      ...options.contextMetadata,
    };
    const mergedText = [target.text, options.contextText].filter(Boolean).join('\n\n---\n');

    let judgement: Awaited<ReturnType<SkillJudgerPort['judge']>>;
    try {
      judgement = await this.judger.judge({
        type: 'skill',
        id: `${skillId}:${version}`,
        title: target.title,
        text: mergedText,
        metadata: mergedMetadata,
      });
    } catch (error) {
      await this.audit.append(AuditEntry.create({
        skillId,
        skillVersion: version,
        action: 'judge_skill_version_failed',
        actor: options.actor ?? 'system',
        after: { errorCategory: judgementErrorCategory(error) },
      }));
      this.judgementEvents?.({
        event: 'judgement_execution',
        outcome: 'failure',
        operation: 'skill_version',
        skillId,
        version,
        proposalId: readString(options.contextMetadata, 'proposalId'),
        errorCategory: judgementErrorCategory(error),
      });
      throw error;
    }

    await this.audit.append(
      AuditEntry.create({
        skillId,
        skillVersion: version,
        action: 'judge_skill_version',
        actor: options.actor ?? 'system',
        after: {
          targetId: `${skillId}:${version}`,
          judgement: serializeJudgement(judgement),
        },
      })
    );
    await this.catalog?.upsertSkillJudgement(skillId, version, judgement);
    this.judgementEvents?.({
      event: 'judgement_execution',
      outcome: 'success',
      operation: 'skill_version',
      skillId,
      version,
      proposalId: readString(options.contextMetadata, 'proposalId'),
    });
    await this.judgeVersionFiles(skillId, version, options.actor ?? 'system');

    return judgement;
  }

  private async judgeVersionFiles(skillId: string, version: string, actor: string): Promise<void> {
    if (!this.storage || !this.scanner) {
      return;
    }

    const files = await this.storage.listSkillFiles(skillId, version);
    for (const file of files) {
      const stored = await this.storage.readSkillFile(skillId, version, file.path);
      if (!stored) {
        continue;
      }

      try {
        const scanned = isTextLikeArtifact(stored.mimeType, file.path)
          ? {
              text: stored.content.toString('utf-8'),
              metadata: { mimeType: stored.mimeType, filePath: file.path, extractor: 'native' },
              extractedBy: 'native',
            }
          : await this.scanner.scan(stored.content, stored.mimeType, file.path);
        const fileJudgement = await this.judger.judge({
          type: 'file',
          id: `${skillId}:${version}:${file.path}`,
          title: file.path,
          text: truncate(scanned.text, MAX_SKILL_FILE_TEXT_CHARS),
          metadata: {
            skillId,
            version,
            path: file.path,
            mimeType: stored.mimeType,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
            extractedBy: scanned.extractedBy,
          },
        });
        await this.catalog?.upsertSkillJudgement(skillId, version, fileJudgement);
        await this.audit.append(
          AuditEntry.create({
            skillId,
            skillVersion: version,
            action: 'judge_skill_file',
            actor,
            after: {
              targetId: fileJudgement.targetId,
              judgement: serializeJudgement(fileJudgement),
            },
          })
        );
        this.judgementEvents?.({
          event: 'judgement_execution',
          outcome: 'success',
          operation: 'skill_file',
          skillId,
          version,
          filePath: file.path,
        });
      } catch (error) {
        await this.audit.append(
          AuditEntry.create({
            skillId,
            skillVersion: version,
            action: 'judge_skill_file_failed',
            actor,
            after: { file: file.path, error: (error as Error).message },
          })
        );
        this.judgementEvents?.({
          event: 'judgement_execution',
          outcome: 'failure',
          operation: 'skill_file',
          skillId,
          version,
          filePath: file.path,
          errorCategory: judgementErrorCategory(error),
        });
      }
    }
  }

  private async resolveRepositoryTarget(skillId: string, version: string) {
    const skill = await this.repo.findById(skillId);
    if (!skill) {
      throw new NotFoundError(`Skill ${skillId} not found`);
    }

    const skillVersion = skill.getAllVersions().find((candidate) => candidate.version === version);
    if (!skillVersion) {
      throw new NotFoundError(`Skill version ${skillId}@${version} not found`);
    }

    return {
      title: skillVersion.manifest.title,
      text: serializeSkillVersion(skillVersion),
      metadata: {
        skillId,
        version,
        groups: skillVersion.manifest.groups,
        capabilities: skillVersion.manifest.capabilities,
        status: skillVersion.status,
      },
    };
  }

  private async resolveCatalogTarget(skillId: string, version: string) {
    if (!this.catalog) {
      return null;
    }

    const catalogVersion = await this.catalog.getSkillVersion(skillId, version);
    if (!catalogVersion) {
      return null;
    }

    const files = await this.catalog.listVersionFiles(skillId, version);
    return {
      title: catalogVersion.title,
      text: serializeCatalogSkillVersion(catalogVersion, files),
      metadata: {
        skillId,
        version,
        groups: [catalogVersion.category, ...catalogVersion.tags],
        capabilities: catalogVersion.capabilities,
        status: catalogVersion.status,
      },
    };
  }
}

function serializeSkillVersion(skillVersion: SkillVersion): string {
  return JSON.stringify(
    {
      id: skillVersion.manifest.id,
      version: skillVersion.version,
      title: skillVersion.manifest.title,
      description: skillVersion.manifest.description,
      status: skillVersion.status,
      groups: skillVersion.manifest.groups,
      capabilities: skillVersion.manifest.capabilities,
      useWhen: skillVersion.manifest.useWhen,
      doNotUseWhen: skillVersion.manifest.doNotUseWhen,
      entrypoint: skillVersion.manifest.entrypoint,
      files: skillVersion.manifest.files.map((file) => ({
        path: file.path,
        role: file.role,
        mimeType: file.mimeType,
      })),
    },
    null,
    2
  );
}

function serializeJudgement(judgement: Awaited<ReturnType<SkillJudgerPort['judge']>>) {
  return {
    id: judgement.id,
    targetType: judgement.targetType,
    targetId: judgement.targetId,
    dimensions: judgement.dimensions,
    overallRisk: judgement.overallRisk,
    summary: judgement.summary,
    skillPurposeSummary: judgement.skillPurposeSummary,
    model: judgement.model,
    createdAt: judgement.createdAt.toISOString(),
  };
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' ? value : undefined;
}

function serializeCatalogSkillVersion(
  skillVersion: CatalogSkillVersionRecord,
  files: Array<{ path: string; role: string; mimeType: string }>
) {
  return JSON.stringify(
    {
      id: skillVersion.skillId,
      version: skillVersion.version,
      title: skillVersion.title,
      description: skillVersion.description,
      status: skillVersion.status,
      groups: [skillVersion.category, ...skillVersion.tags],
      capabilities: skillVersion.capabilities,
      useWhen: skillVersion.useWhen,
      doNotUseWhen: skillVersion.doNotUseWhen,
      entrypoint: skillVersion.entrypoint,
      files: files.map((file) => ({
        path: file.path,
        role: file.role,
        mimeType: file.mimeType,
      })),
    },
    null,
    2
  );
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n\n[TRUNCATED ${text.length - maxLength} CHARS]`;
}
