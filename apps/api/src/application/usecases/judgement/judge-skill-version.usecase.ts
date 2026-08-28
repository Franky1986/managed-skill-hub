import { NotFoundError } from '../../../domain/errors';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillJudgerPort } from '../../ports/outbound/judger.port';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { isTextLikeArtifact } from '../skill/public-metadata';
import { JudgementRuntimeEventSink, judgementErrorCategory } from './judgement-runtime-event';
import { Judgement } from '../../../domain/judgement/Judgement';
import { buildFileJudgementTarget, buildGlobalJudgementTarget, cloneJudgementForTarget, findReusableJudgement, truncateJudgementText, withJudgementInputFingerprint } from './judgement-input';

export class JudgeSkillVersionUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly judger: SkillJudgerPort,
    private readonly audit: AuditLogPort,
    private readonly catalog?: SkillCatalogPort,
    private readonly storage?: SkillFileStoragePort,
    private readonly scanner?: FileScannerPort,
    private readonly judgementEvents?: JudgementRuntimeEventSink,
    private readonly judgementReuseScope = 'default'
  ) {}

  async execute(
    skillId: string,
    version: string,
    options: {
      contextText?: string;
      contextMetadata?: Record<string, unknown>;
      actor?: string;
      reuseJudgements?: Judgement[];
    } = {}
  ) {
    const target = (await this.resolveCatalogTarget(skillId, version)) ?? (await this.resolveRepositoryTarget(skillId, version));

    let judgement: Awaited<ReturnType<SkillJudgerPort['judge']>>;
    let reusedGlobal = false;
    try {
      const globalTarget = buildGlobalJudgementTarget({
        targetType: 'skill', targetId: `${skillId}:${version}`, title: target.title,
        description: target.description, category: target.category, tags: target.tags,
        capabilities: target.capabilities, useWhen: target.useWhen, doNotUseWhen: target.doNotUseWhen,
        entrypoint: target.entrypoint, files: target.files,
      });
      // Kept for programmatic legacy callers. Context becomes part of the
      // canonical input, so it cannot accidentally reuse a different prompt.
      const effectiveTarget = options.contextText?.trim()
        ? { ...globalTarget, text: `${globalTarget.text}\n\n---\n${options.contextText.trim()}` }
        : globalTarget;
      const reusable = findReusableJudgement(effectiveTarget, options.reuseJudgements ?? [], this.judgementReuseScope, this.judger.modelIdentity ?? null);
      reusedGlobal = reusable !== null;
      judgement = reusable
        ? cloneJudgementForTarget(reusable, 'skill', effectiveTarget.id)
        : withJudgementInputFingerprint(await this.judger.judge(effectiveTarget), effectiveTarget, this.judgementReuseScope, this.judger.modelIdentity ?? null);
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
    if (reusedGlobal) {
      await this.audit.append(AuditEntry.create({ skillId, skillVersion: version, action: 'reuse_skill_judgement',
        actor: options.actor ?? 'system', after: { targetId: judgement.targetId, inputFingerprint: judgement.inputFingerprint } }));
    }
    this.judgementEvents?.({
      event: 'judgement_execution',
      outcome: 'success',
      operation: 'skill_version',
      skillId,
      version,
      proposalId: readString(options.contextMetadata, 'proposalId'),
    });
    await this.judgeVersionFiles(skillId, version, options.actor ?? 'system', options.reuseJudgements ?? []);

    return judgement;
  }

  private async judgeVersionFiles(skillId: string, version: string, actor: string, reuseJudgements: Judgement[]): Promise<void> {
    if (!this.storage || !this.scanner) {
      return;
    }

    const storage = this.storage;
    const scanner = this.scanner;
    const files = await storage.listSkillFiles(skillId, version);
    // Keep read/extract/scan bounded as well as provider calls. Provider calls
    // are globally limited by BoundedSkillJudger; sequential local work avoids
    // a large artifact upload creating an unbounded Buffer/scan fan-out.
    for (const file of files) {
      const stored = await storage.readSkillFile(skillId, version, file.path);
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
          : await scanner.scan(stored.content, stored.mimeType, file.path);
        const target = buildFileJudgementTarget({ targetId: `${skillId}:${version}:${file.path}`, path: file.path,
          text: truncateJudgementText(scanned.text), mimeType: stored.mimeType, sizeBytes: file.sizeBytes,
          sha256: file.sha256, extractedBy: scanned.extractedBy });
        const reusable = findReusableJudgement(target, reuseJudgements, this.judgementReuseScope, this.judger.modelIdentity ?? null);
        const fileJudgement = reusable
          ? cloneJudgementForTarget(reusable, 'file', target.id)
          : withJudgementInputFingerprint(await this.judger.judge(target), target, this.judgementReuseScope, this.judger.modelIdentity ?? null);
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
        if (reusable) await this.audit.append(AuditEntry.create({ skillId, skillVersion: version, action: 'reuse_skill_file_judgement', actor,
          after: { targetId: target.id, sourceJudgementId: reusable.id, inputFingerprint: fileJudgement.inputFingerprint } }));
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
            after: { file: file.path, errorCategory: judgementErrorCategory(error) },
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

    const storedFiles = this.storage ? await this.storage.listSkillFiles(skillId, version) : [];
    const storedByPath = new Map(storedFiles.map((file) => [file.path, file]));
    return { title: skillVersion.manifest.title, description: skillVersion.manifest.description, category: skillVersion.manifest.category,
      tags: skillVersion.manifest.tags, capabilities: skillVersion.manifest.capabilities, useWhen: skillVersion.manifest.useWhen,
      doNotUseWhen: skillVersion.manifest.doNotUseWhen, entrypoint: skillVersion.manifest.entrypoint,
      files: skillVersion.manifest.files.map((file) => { const stored = storedByPath.get(file.path); return { path: file.path,
        role: file.role, mimeType: file.mimeType, sizeBytes: stored?.sizeBytes ?? null, sha256: file.sha256 }; }) };
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
    return { title: catalogVersion.title, description: catalogVersion.description, category: catalogVersion.category,
      tags: catalogVersion.tags, capabilities: catalogVersion.capabilities, useWhen: catalogVersion.useWhen,
      doNotUseWhen: catalogVersion.doNotUseWhen, entrypoint: catalogVersion.entrypoint,
      files: files.map((file) => ({ path: file.path, role: file.role, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256: file.sha256 })) };
  }
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
