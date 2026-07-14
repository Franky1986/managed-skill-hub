import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { Proposal } from '../../../domain/proposal/Proposal';
import { NotFoundError } from '../../../domain/errors';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { SkillJudgerPort } from '../../ports/outbound/judger.port';
import { ReviewProposalUseCase } from './review-proposal.usecase';
import { SkillCommandPort } from '../../ports/inbound/skill-command.port';
import { buildProposalAggregateFromCatalog } from './catalog-proposal-hydrator';
import { ProposalDuplicateCheckUseCase } from './duplicate-check.usecase';
import { DuplicateCheckInputDto } from '../../dtos/proposal.dto';
import { isExtractableArtifact } from '../skill/public-metadata';
import { JudgementRisk } from '../../../domain/judgement/Judgement';

export type AutoPublishBlockedReason =
  | 'incomplete_upload'
  | 'duplicate_or_collision'
  | 'non_green_judgement'
  | 'category_blocked'
  | 'classifier_failed'
  | 'manual_review_required';

export interface AutoPublishEvaluation {
  enabled: boolean;
  eligible: boolean | null;
  blockedReason: AutoPublishBlockedReason | null;
  blockedByCategory: boolean | null;
  classifierReason: string | null;
  matchedExcludedCategory: string | null;
  autoPublished: boolean;
  publishedSkillId: string | null;
  publishedVersion: string | null;
}

interface AutoPublishConfig {
  enabled: boolean;
  excludedCategories: string[];
  autoApproveWithoutJudger: boolean;
  similarityThreshold: number;
}

const AUTO_PUBLISH_ACTOR = 'system:auto-publish';

export class AutoPublishProposalUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly audit: AuditLogPort,
    private readonly scanner: FileScannerPort,
    private readonly judger: SkillJudgerPort,
    private readonly reviewProposal: ReviewProposalUseCase,
    private readonly reviewSkill: SkillCommandPort,
    private readonly config: AutoPublishConfig,
    private readonly catalog?: SkillCatalogPort,
    private readonly duplicateCheck?: ProposalDuplicateCheckUseCase
  ) {}

  async execute(proposalId: string): Promise<AutoPublishEvaluation> {
    const proposal = await this.loadProposal(proposalId);
    if (!proposal) {
      throw new NotFoundError(`Proposal ${proposalId} not found`);
    }

    if (!this.config.enabled) {
      return {
        enabled: false,
        eligible: null,
        blockedReason: null,
        blockedByCategory: null,
        classifierReason: null,
        matchedExcludedCategory: null,
        autoPublished: false,
        publishedSkillId: null,
        publishedVersion: null,
      };
    }

    const auditEntries = await this.audit.findByProposalId(proposalId);
    const duplicateBlocked = await this.hasDuplicateBlocker(proposal);
    const semanticDuplicate = await this.hasSemanticDuplicate(proposal);
    if (semanticDuplicate) {
      return this.recordEvaluation(proposal.id, {
        enabled: true,
        eligible: false,
        blockedReason: 'manual_review_required',
        blockedByCategory: null,
        classifierReason: `Similarity score ${semanticDuplicate.similarityScore.toFixed(2)} to existing ${semanticDuplicate.kind} '${semanticDuplicate.title}' (id: ${semanticDuplicate.id}) exceeds the auto-publish threshold of ${this.config.similarityThreshold ?? 0.7}. A human reviewer must decide whether to create a new skill or update the existing one.`,
        matchedExcludedCategory: null,
        autoPublished: false,
        publishedSkillId: null,
        publishedVersion: null,
      });
    }
    if (proposal.status === 'in_upload') {
      return this.recordEvaluation(proposal.id, {
        enabled: true,
        eligible: false,
        blockedReason: 'incomplete_upload',
        blockedByCategory: null,
        classifierReason: 'Upload is not finalized yet.',
        matchedExcludedCategory: null,
        autoPublished: false,
        publishedSkillId: null,
        publishedVersion: null,
      });
    }
    if (duplicateBlocked) {
      return this.recordEvaluation(proposal.id, {
        enabled: true,
        eligible: false,
        blockedReason: 'duplicate_or_collision',
        blockedByCategory: null,
        classifierReason: 'Duplicate published content or duplicate proposal content blocks automation.',
        matchedExcludedCategory: null,
        autoPublished: false,
        publishedSkillId: null,
        publishedVersion: null,
      });
    }
    if (hasManualReviewBlocker(auditEntries, proposal.submittedBy)) {
      return this.recordEvaluation(proposal.id, {
        enabled: true,
        eligible: false,
        blockedReason: 'manual_review_required',
        blockedByCategory: null,
        classifierReason: 'Manual admin intervention already happened on this proposal.',
        matchedExcludedCategory: null,
        autoPublished: false,
        publishedSkillId: null,
        publishedVersion: null,
      });
    }
    if (!hasFullyGreenJudgements(proposal, !this.config.autoApproveWithoutJudger)) {
      const noRealJudgements = !this.config.autoApproveWithoutJudger && hasNonRealJudgements(proposal);
      return this.recordEvaluation(proposal.id, {
        enabled: true,
        eligible: false,
        blockedReason: 'non_green_judgement',
        blockedByCategory: null,
        classifierReason: noRealJudgements
          ? 'Auto-publish requires real judgements. Set AUTO_APPROVE_WITHOUT_JUDGER=true to allow noop judgments.'
          : 'Proposal-level or file-level judgement is missing or not fully green.',
        matchedExcludedCategory: null,
        autoPublished: false,
        publishedSkillId: null,
        publishedVersion: null,
      });
    }

    if (!this.judger.classifyAutoPublishCategory) {
      return this.recordEvaluation(proposal.id, {
        enabled: true,
        eligible: false,
        blockedReason: 'classifier_failed',
        blockedByCategory: null,
        classifierReason: 'Configured judger does not implement the auto-publish category classifier.',
        matchedExcludedCategory: null,
        autoPublished: false,
        publishedSkillId: null,
        publishedVersion: null,
      });
    }

    const classificationInput = await this.buildCategoryClassifierContent(proposal);
    try {
      const categoryResult = await this.judger.classifyAutoPublishCategory({
        proposalId: proposal.id,
        title: proposal.title,
        description: proposal.description,
        category: proposal.category,
        tags: proposal.tags,
        capabilities: proposal.capabilities,
        entrypoint: proposal.entrypoint,
        excludedCategories: this.config.excludedCategories,
        content: classificationInput,
      });

      if (categoryResult.blocked) {
        return this.recordEvaluation(proposal.id, {
          enabled: true,
          eligible: false,
          blockedReason: 'category_blocked',
          blockedByCategory: true,
          classifierReason: categoryResult.reason,
          matchedExcludedCategory: categoryResult.matchedCategory,
          autoPublished: false,
          publishedSkillId: null,
          publishedVersion: null,
        });
      }

      const initialDecision = await this.recordEvaluation(proposal.id, {
        enabled: true,
        eligible: true,
        blockedReason: null,
        blockedByCategory: false,
        classifierReason: categoryResult.reason,
        matchedExcludedCategory: categoryResult.matchedCategory,
        autoPublished: false,
        publishedSkillId: null,
        publishedVersion: null,
      });

      try {
        const skill = await this.reviewProposal.convertProposal(proposal.id, AUTO_PUBLISH_ACTOR, 'Automatic proposal conversion after fully green evaluation.');
        const targetVersion = skill.getAllVersions()[skill.getAllVersions().length - 1]?.version ?? '1.0.0';
        await this.reviewSkill.submitForReview(skill.id.toString(), targetVersion, AUTO_PUBLISH_ACTOR);
        await this.reviewSkill.approve(skill.id.toString(), targetVersion, AUTO_PUBLISH_ACTOR);
        await this.reviewSkill.publish(skill.id.toString(), targetVersion, AUTO_PUBLISH_ACTOR);
        await this.audit.append(
          AuditEntry.create({
            proposalId: proposal.id,
            skillId: skill.id.toString(),
            skillVersion: targetVersion,
            action: 'auto_publish_proposal',
            actor: AUTO_PUBLISH_ACTOR,
            after: {
              skillId: skill.id.toString(),
              version: targetVersion,
            },
          })
        );
        return {
          ...initialDecision,
          autoPublished: true,
          publishedSkillId: skill.id.toString(),
          publishedVersion: targetVersion,
        };
      } catch (error) {
        await this.audit.append(
          AuditEntry.create({
            proposalId: proposal.id,
            action: 'auto_publish_failed',
            actor: AUTO_PUBLISH_ACTOR,
            after: {
              error: (error as Error).message,
            },
          })
        );
        return {
          ...initialDecision,
          eligible: false,
          blockedReason: 'manual_review_required',
        };
      }
    } catch (error) {
      return this.recordEvaluation(proposal.id, {
        enabled: true,
        eligible: false,
        blockedReason: 'classifier_failed',
        blockedByCategory: null,
        classifierReason: (error as Error).message,
        matchedExcludedCategory: null,
        autoPublished: false,
        publishedSkillId: null,
        publishedVersion: null,
      });
    }
  }

  private async buildCategoryClassifierContent(proposal: Proposal): Promise<string> {
    const parts: string[] = [];
    for (const file of proposal.files) {
      if (!isExtractableArtifact(file.mimeType, file.path)) {
        continue;
      }

      const stored = await this.storage.readProposalFile(proposal.id, file.path);
      if (!stored) {
        continue;
      }

      try {
        const scanned = await this.scanner.scan(stored.content, stored.mimeType, file.path);
        if (scanned.text.trim().length > 0) {
          parts.push(`FILE ${file.path}\n${scanned.text}`);
        }
      } catch {
        // Extraction failures are treated conservatively later through missing fully-green judgements.
      }
    }

    return [
      `Title: ${proposal.title}`,
      `Description: ${proposal.description}`,
      `Category: ${proposal.category}`,
      `Tags: ${proposal.tags.join(', ')}`,
      `Capabilities: ${proposal.capabilities.join(', ')}`,
      `Entrypoint: ${proposal.entrypoint ?? ''}`,
      '',
      parts.join('\n\n'),
    ].join('\n');
  }


  private async hasSemanticDuplicate(proposal: Proposal): Promise<{ kind: 'proposal' | 'skill'; id: string; title: string; similarityScore: number } | null> {
    if (!this.duplicateCheck || (this.config.similarityThreshold ?? 0.7) <= 0) {
      return null;
    }
    const input: DuplicateCheckInputDto = {
      skillId: proposal.skillId ?? undefined,
      title: proposal.title,
      description: proposal.description,
      category: proposal.category,
      tags: proposal.tags,
      capabilities: proposal.capabilities,
      entrypoint: proposal.entrypoint ?? undefined,
      files: proposal.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    };

    const result = await this.duplicateCheck.execute(input);
    const match = result.similarMatches[0];
    if (match && match.similarityScore >= (this.config.similarityThreshold ?? 0.7)) {
      return {
        kind: match.kind,
        id: match.id,
        title: match.title,
        similarityScore: match.similarityScore,
      };
    }
    return null;
  }

  private async hasDuplicateBlocker(proposal: Proposal): Promise<boolean> {
    if (!this.catalog || !proposal.contentDigest) {
      return false;
    }

    const duplicateProposal = await this.catalog.findProposalByContentDigest(proposal.contentDigest, proposal.id);
    if (duplicateProposal) {
      return true;
    }

    const duplicateSkill = await this.catalog.findPublishedSkillByContentDigest(proposal.contentDigest);
    return duplicateSkill !== null;
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

  private async recordEvaluation(proposalId: string, evaluation: AutoPublishEvaluation): Promise<AutoPublishEvaluation> {
    await this.audit.append(
      AuditEntry.create({
        proposalId,
        action: 'evaluate_auto_publish',
        actor: AUTO_PUBLISH_ACTOR,
        after: {
          enabled: evaluation.enabled,
          eligible: evaluation.eligible,
          blockedReason: evaluation.blockedReason,
          blockedByCategory: evaluation.blockedByCategory,
          classifierReason: evaluation.classifierReason,
          matchedExcludedCategory: evaluation.matchedExcludedCategory,
          autoPublished: evaluation.autoPublished,
          publishedSkillId: evaluation.publishedSkillId,
          publishedVersion: evaluation.publishedVersion,
        },
      })
    );
    return evaluation;
  }
}

function hasManualReviewBlocker(entries: AuditEntry[], submittedBy: string): boolean {
  return entries.some((entry) => {
    if (entry.actor === AUTO_PUBLISH_ACTOR) {
      return false;
    }
    if (entry.action === 'update_proposal_metadata' && entry.actor !== submittedBy) {
      return true;
    }
    if (entry.action === 'reject_proposal') {
      return true;
    }
    return false;
  });
}

function hasFullyGreenJudgements(proposal: Proposal, requireRealJudgement: boolean): boolean {
  const proposalJudgement = [...proposal.judgements]
    .filter((judgement) => judgement.targetType === 'proposal')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .at(-1);
  if (!proposalJudgement || !isFullyGreen(proposalJudgement, !requireRealJudgement) || !isRealJudgement(proposalJudgement, requireRealJudgement)) {
    return false;
  }

  const judgableFiles = proposal.files.filter((file) => isExtractableArtifact(file.mimeType, file.path));
  for (const file of judgableFiles) {
    const fileJudgement = [...proposal.judgements]
      .filter((judgement) => judgement.targetType === 'file' && judgement.targetId === `${proposal.id}:${file.path}`)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .at(-1);
    if (!fileJudgement || !isFullyGreen(fileJudgement, !requireRealJudgement) || !isRealJudgement(fileJudgement, requireRealJudgement)) {
      return false;
    }
  }

  return true;
}

function hasNonRealJudgements(proposal: Proposal): boolean {
  const proposalJudgement = [...proposal.judgements]
    .filter((judgement) => judgement.targetType === 'proposal')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .at(-1);
  const fileJudgements = proposal.files
    .filter((file) => isExtractableArtifact(file.mimeType, file.path))
    .map((file) =>
      [...proposal.judgements]
        .filter((judgement) => judgement.targetType === 'file' && judgement.targetId === `${proposal.id}:${file.path}`)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .at(-1)
    )
    .filter((judgement): judgement is NonNullable<typeof judgement> => judgement !== undefined && judgement !== null);

  const allJudgements = [proposalJudgement, ...fileJudgements].filter((judgement): judgement is NonNullable<typeof judgement> => judgement !== undefined && judgement !== null);

  return allJudgements.some((judgement) => !isRealJudgement(judgement, true));
}

function isFullyGreen(judgement: Proposal['judgements'][number], allowNoJudgeAvailable = false): boolean {
  if (judgement.overallRisk !== JudgementRisk.LOW) {
    if (!(allowNoJudgeAvailable && judgement.overallRisk === 'no_judge_available')) {
      return false;
    }
  }
  return Object.values(judgement.dimensions).every((dimension) => dimension.risk === JudgementRisk.LOW);
}

function isRealJudgement(judgement: Proposal['judgements'][number], requireRealJudgement: boolean): boolean {
  if (!requireRealJudgement) {
    return true;
  }

  return judgement.model !== null && judgement.model !== 'noop';
}
