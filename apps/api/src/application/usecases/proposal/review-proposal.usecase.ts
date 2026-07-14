import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { NotFoundError, ProposalUploadNotOpenError, ValidationError } from '../../../domain/errors';
import { Manifest } from '../../../domain/skill/Manifest';
import { ManifestFile, FileRole } from '../../../domain/skill/ManifestFile';
import { Skill } from '../../../domain/skill/Skill';
import { SkillId } from '../../../domain/skill/SkillId';
import { SkillStatus } from '../../../domain/skill/SkillStatus';
import { SkillVersion } from '../../../domain/skill/SkillVersion';
import { Proposal } from '../../../domain/proposal/Proposal';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { CreateSkillUseCase } from '../skill/create-skill.usecase';
import { ExtractSkillFileContentUseCase } from '../skill/extract-skill-file-content.usecase';
import { JudgeSkillVersionUseCase } from '../judgement/judge-skill-version.usecase';
import { buildSkillAggregateFromCatalog } from '../skill/catalog-skill-hydrator';
import { buildProposalAggregateFromCatalog } from './catalog-proposal-hydrator';
import { JudgementRuntimeEventSink, judgementErrorCategory } from '../judgement/judgement-runtime-event';

interface ProposalMetadataUpdate {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  capabilities?: string[];
  entrypoint?: string | null;
}

export class ReviewProposalUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly audit: AuditLogPort,
    private readonly createSkill: CreateSkillUseCase,
    private readonly judgeSkillVersion: JudgeSkillVersionUseCase | undefined,
    private readonly catalog?: SkillCatalogPort,
    private readonly extractSkillFileContent?: ExtractSkillFileContentUseCase,
    private readonly judgementEvents?: JudgementRuntimeEventSink
  ) {}

  async rejectProposal(proposalId: string, actor: string, reason?: string | null, comment?: string | null): Promise<Proposal> {
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new NotFoundError(`Proposal ${proposalId} not found`);
    }

    const updated = proposal.reject(reason ?? null);
    await this.repo.saveProposal(updated);
    await this.audit.append(
      AuditEntry.create({
        proposalId,
        action: 'reject_proposal',
        actor,
        before: { status: proposal.status },
        after: { status: updated.status, reason: updated.rejectionReason, comment: comment?.trim() ?? null },
      })
    );
    return updated;
  }

  async deleteOpenProposal(proposalId: string, actor: string): Promise<void> {
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new NotFoundError(`Proposal ${proposalId} not found`);
    }
    if (proposal.status !== 'in_upload') {
      throw new ProposalUploadNotOpenError(proposalId, proposal.status);
    }

    await this.repo.deleteProposal(proposalId);
    await this.audit.append(
      AuditEntry.create({
        proposalId,
        action: 'delete_proposal',
        actor,
        before: { status: proposal.status },
        after: { administrativeCleanup: true },
      })
    );
  }

  async convertProposal(proposalId: string, actor: string, comment?: string | null): Promise<Skill> {
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new NotFoundError(`Proposal ${proposalId} not found`);
    }

    const duplicateWarning = await this.detectDuplicateContent(proposal);
    if (duplicateWarning) {
      await this.audit.append(
        AuditEntry.create({
          proposalId: proposal.id,
          action: 'convert_proposal_duplicate_warning',
          actor,
          after: duplicateWarning,
        })
      );
    }

    const skill = await this.materializeSkillFromProposal(proposal, actor);
    const targetVersion = this.getLatestVersionFromSkill(skill);
    if (this.extractSkillFileContent) {
      await this.extractDraftVersionArtifacts(skill.id.toString(), targetVersion, actor, proposal.id);
    }

    const converted = proposal.approve().convert();
    await this.repo.saveProposal(converted);
    if (this.judgeSkillVersion) {
      try {
        const contextText = this.buildGlobalJudgementContext(proposal);
        await this.judgeSkillVersion.execute(skill.id.toString(), targetVersion, {
          contextText,
          contextMetadata: {
            proposalId: proposal.id,
            proposalStatus: converted.status,
            proposalTargetMode: proposal.skillId ? 'create_version' : 'create_skill',
            nextVersion: targetVersion,
          },
          actor,
        });
        this.judgementEvents?.({
          event: 'judgement_execution',
          outcome: 'success',
          operation: 'skill_version',
          proposalId: proposal.id,
          skillId: skill.id.toString(),
          version: targetVersion,
        });
      } catch (error) {
        await this.audit.append(
          AuditEntry.create({
            proposalId,
            skillId: skill.id.toString(),
            skillVersion: targetVersion,
            action: 'convert_proposal_skill_judgement_failed',
            actor,
            after: { error: (error as Error).message },
          })
        );
        this.judgementEvents?.({
          event: 'judgement_execution',
          outcome: 'failure',
          operation: 'skill_version',
          proposalId: proposal.id,
          skillId: skill.id.toString(),
          version: targetVersion,
          errorCategory: judgementErrorCategory(error),
        });
      }
    }
    await this.audit.append(
      AuditEntry.create({
        proposalId,
        skillId: skill.id.toString(),
        skillVersion: skill.getAllVersions()[skill.getAllVersions().length - 1]?.version ?? '1.0.0',
        action: 'convert_proposal',
        actor,
        before: { status: proposal.status },
        after: { status: converted.status, skillId: skill.id.toString(), version: skill.getAllVersions()[skill.getAllVersions().length - 1]?.version ?? '1.0.0', comment: comment?.trim() ?? null },
      })
    );

    return skill;
  }

  private async extractDraftVersionArtifacts(
    skillId: string,
    version: string,
    actor: string,
    proposalId: string
  ): Promise<void> {
    const files = await this.storage.listSkillFiles(skillId, version);
    for (const file of files) {
      try {
        await this.extractSkillFileContent!.execute(skillId, file.path, {
          version,
          includeUnpublished: true,
          forceRefresh: true,
        });
      } catch (error) {
        await this.audit.append(
          AuditEntry.create({
            proposalId,
            skillId,
            skillVersion: version,
            action: 'extract_skill_file_failed',
            actor,
            after: { path: file.path, error: (error as Error).message },
          })
        );
      }
    }
  }

  async updateProposalMetadata(proposalId: string, actor: string, update: ProposalMetadataUpdate): Promise<Proposal> {
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new NotFoundError(`Proposal ${proposalId} not found`);
    }
    if (Object.keys(update).length === 0) {
      throw new ValidationError('No metadata provided for update');
    }

    const updated = proposal.updateMetadata(update);
    await this.repo.saveProposal(updated);
    await this.audit.append(
      AuditEntry.create({
        proposalId,
        action: 'update_proposal_metadata',
        actor,
        before: {
          title: proposal.title,
          description: proposal.description,
          category: proposal.category,
          tags: proposal.tags,
          capabilities: proposal.capabilities,
          entrypoint: proposal.entrypoint,
        },
        after: {
          title: updated.title,
          description: updated.description,
          category: updated.category,
          tags: updated.tags,
          capabilities: updated.capabilities,
          entrypoint: updated.entrypoint,
        },
      })
    );
    return updated;
  }

  private async materializeSkillFromProposal(proposal: Proposal, actor: string): Promise<Skill> {
    if (!proposal.skillId) {
      const skillId = await this.resolveNewSkillId(proposal);
      const skillTitle = await this.resolveNewSkillTitle(proposal.title);
      const files = await this.loadProposalFiles(proposal);
      return this.createSkill.createSkill(
        {
          id: skillId,
          title: skillTitle,
          description: proposal.description,
          category: proposal.category,
          tags: proposal.tags,
          capabilities: proposal.capabilities,
          entrypoint: proposal.entrypoint ?? files[0]?.path ?? 'README.md',
          files,
        },
        actor
      );
    }

    const existing = await this.loadSkill(proposal.skillId);
    if (!existing) {
      return this.createSkill.createSkill(
        {
          id: proposal.skillId,
          title: proposal.title,
          description: proposal.description,
          category: proposal.category,
          tags: proposal.tags,
          capabilities: proposal.capabilities,
          entrypoint: proposal.entrypoint ?? 'README.md',
          files: await this.loadProposalFiles(proposal),
        },
        actor
      );
    }

    return this.appendProposalAsNewVersion(existing, proposal, actor);
  }

  private async resolveNewSkillId(proposal: Proposal): Promise<string> {
    if (proposal.skillId) {
      return proposal.skillId;
    }

    const generated = slugify(proposal.title);
    if (!generated) {
      throw new ValidationError('Cannot derive skill id from proposal title');
    }
    const base = generated;
    for (let i = 1; i <= 100; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      try {
        SkillId.create(candidate);
        const exists = await this.repo.exists(candidate);
        if (!exists) {
          return candidate;
        }
      } catch {
        // invalid candidate, continue
      }
    }
    throw new ValidationError(`Cannot derive an available skill id from proposal title ${base}`);
  }

  private async resolveNewSkillTitle(baseTitle: string): Promise<string> {
    if (!this.catalog || !baseTitle) {
      return baseTitle;
    }
    const normalizedExisting = new Set<string>();
    const { items } = await this.catalog.listLatestSkillVersions();
    for (const item of items) {
      if (item.title) {
        normalizedExisting.add(item.title.trim().toLowerCase());
      }
    }

    const base = baseTitle.trim();
    for (let i = 1; i <= 100; i++) {
      const candidate = i === 1 ? base : `${base} (${i})`;
      if (!normalizedExisting.has(candidate.trim().toLowerCase())) {
        return candidate;
      }
    }
    return `${base} (${Date.now()})`;
  }

  private async loadProposalFiles(proposal: Proposal): Promise<Array<{ path: string; content: Buffer; mimeType: string; role: FileRole }>> {
    return Promise.all(
      proposal.files.map(async (file) => {
        const stored = await this.storage.readProposalFile(proposal.id, file.path);
        if (!stored) {
          throw new NotFoundError(`Proposal file ${file.path} not found`);
        }
        return {
          path: file.path,
          content: stored.content,
          mimeType: stored.mimeType,
          role: proposal.entrypoint === file.path ? FileRole.ENTRYPOINT : FileRole.ATTACHMENT,
        };
      })
    );
  }

  private async appendProposalAsNewVersion(skill: Skill, proposal: Proposal, actor: string): Promise<Skill> {
    const files = await this.loadProposalFiles(proposal);
    const latest = skill.getAllVersions()[skill.getAllVersions().length - 1];
    const nextVersion = latest ? bumpPatchVersion(latest.version) : '1.0.0';
    const manifestFiles: ManifestFile[] = [];

    for (const file of files) {
      const stored = await this.storage.storeSkillFile(
        skill.id.toString(),
        nextVersion,
        file.path,
        file.content,
        file.mimeType
      );
      manifestFiles.push(
        ManifestFile.create({
          path: stored.path,
          role: file.role,
          mimeType: stored.mimeType,
          sha256: stored.sha256,
        })
      );
    }

    skill.addVersion(
      SkillVersion.create({
        skillId: skill.id,
        version: nextVersion,
        createdBy: actor,
        manifest: Manifest.create({
          id: skill.id.toString(),
          title: proposal.title,
          description: proposal.description,
          version: nextVersion,
          status: SkillStatus.DRAFT,
          category: proposal.category,
          tags: proposal.tags,
          capabilities: proposal.capabilities,
          entrypoint: proposal.entrypoint ?? files[0]?.path ?? 'README.md',
          files: manifestFiles,
        }),
      })
    );

    await this.repo.save(skill);
    await this.audit.append(
      AuditEntry.create({
        skillId: skill.id.toString(),
        skillVersion: nextVersion,
        proposalId: proposal.id,
        action: 'create_skill_version_from_proposal',
        actor,
        after: { skillId: skill.id.toString(), version: nextVersion },
      })
    );
    return skill;
  }

  private async loadSkill(skillId: string): Promise<Skill | null> {
    if (this.catalog) {
      const skill = await buildSkillAggregateFromCatalog(this.catalog, skillId);
      if (skill) {
        return skill;
      }
    }

    return this.repo.findById(skillId);
  }


  private async detectDuplicateContent(proposal: Proposal): Promise<Record<string, unknown> | null> {
    if (!this.catalog || !proposal.contentDigest) {
      return null;
    }
    const duplicateProposal = await this.catalog.findProposalByContentDigest(proposal.contentDigest, proposal.id);
    if (duplicateProposal) {
      return {
        type: 'duplicate_proposal',
        contentDigest: proposal.contentDigest,
        duplicateProposalId: duplicateProposal.id,
        message: 'Another proposal with identical content exists. Conversion is allowed; admin should decide which proposal to publish.',
      };
    }
    const duplicateSkill = await this.catalog.findPublishedSkillByContentDigest(proposal.contentDigest);
    if (duplicateSkill) {
      return {
        type: 'duplicate_skill',
        contentDigest: proposal.contentDigest,
        duplicateSkillId: duplicateSkill.skillId,
        duplicateVersion: duplicateSkill.version,
        message: 'A published skill with identical content exists. Conversion is allowed; admin should verify whether a new version is needed.',
      };
    }
    return null;
  }
  private async loadProposal(proposalId: string): Promise<Proposal | null> {
    const sourceProposal = await this.repo.findProposalById(proposalId);
    if (sourceProposal) {
      return sourceProposal;
    }

    if (this.catalog) {
      const proposal = await buildProposalAggregateFromCatalog(this.catalog, proposalId);
      if (proposal) {
        return proposal;
      }
    }

    return null;
  }

  private getLatestVersionFromSkill(skill: Skill): string {
    return (
      skill.getAllVersions()[skill.getAllVersions().length - 1]?.version
      ?? '1.0.0'
    );
  }

  private buildGlobalJudgementContext(proposal: Proposal): string {
    const proposalLevelJudgements = proposal.judgements.filter((judgement) => judgement.targetType === 'proposal');
    const fileJudgements = proposal.judgements.filter((judgement) => judgement.targetType === 'file');
    const fileJudgementSummaries = fileJudgements
      .map((judgement) => {
        const suffix = judgement.targetId.startsWith(`${proposal.id}:`)
          ? judgement.targetId.slice(proposal.id.length + 1)
          : judgement.targetId;
        return `${suffix}: ${judgement.overallRisk} (${judgement.summary || 'no summary'})`;
      })
      .join('\n');
    const proposalJudgementSummaries = proposalLevelJudgements
      .map(
        (judgement) => `${judgement.overallRisk} (${judgement.model ?? 'n/a'}): ${judgement.summary || 'no summary'}`
      )
      .join('\n');

    return `Proposal finalization context for skill judgement.

Proposal ID: ${proposal.id}
Title: ${proposal.title}
Description: ${proposal.description}
Groups: ${[proposal.category, ...proposal.tags].join(', ') || 'n/a'}
Capabilities: ${proposal.capabilities.join(', ') || 'n/a'}
Entrypoint: ${proposal.entrypoint ?? 'n/a'}
Submission: ${proposal.submittedBy}
Overall status before finalization: ${proposal.status}

Proposal-level judgements:
${proposalJudgementSummaries || 'none'}

File-level judgements:
${fileJudgementSummaries || 'none'}`;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function bumpPatchVersion(version: string): string {
  const parts = version.split('.').map((part) => Number(part));
  const major = Number.isFinite(parts[0]) ? parts[0] : 1;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  const patch = (Number.isFinite(parts[2]) ? parts[2] : 0) + 1;
  return `${major}.${minor}.${patch}`;
}
