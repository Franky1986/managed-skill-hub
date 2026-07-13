import { Judgement } from '../../../domain/judgement/Judgement';
import { ValidationError } from '../../../domain/errors';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { JudgementDimension } from '../../../domain/judgement/Judgement';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';

export class ListJudgementsUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly audit: AuditLogPort,
    private readonly catalog?: SkillCatalogPort
  ) {}

  async execute(targetType: 'proposal' | 'skill' | 'file', targetId: string): Promise<Judgement[]> {
    if (this.catalog) {
      const catalogJudgements = await this.catalog.listJudgements(targetType, targetId);
      return catalogJudgements.map((judgement) =>
        Judgement.create({
          id: judgement.id,
          targetType: judgement.targetType,
          targetId: judgement.targetId,
          overallRisk: judgement.overallRisk,
          dimensions: judgement.dimensions,
          summary: judgement.summary,
          skillPurposeSummary: judgement.skillPurposeSummary,
          model: judgement.model,
          createdAt: judgement.createdAt,
        })
      );
    }

    if (targetType === 'proposal') {
      const proposal = await this.repo.findProposalById(targetId);
      return proposal?.judgements.filter((judgement) => judgement.targetType === 'proposal') ?? [];
    }

    if (targetType === 'file') {
      const proposals = await this.repo.findProposals();
      return proposals.items.flatMap((proposal) =>
        proposal.judgements.filter(
          (judgement) => judgement.targetType === 'file' && judgement.targetId === targetId
        )
      );
    }

    if (targetType === 'skill') {
      const [skillId] = targetId.split(':');
      const entries = await this.audit.findBySkillId(skillId);
      return entries
        .filter((entry) => entry.action === 'judge_skill_version')
        .map((entry) => entry.after?.judgement)
        .filter((judgement): judgement is StoredJudgement => isStoredJudgement(judgement, targetId))
        .map((judgement) =>
          Judgement.create({
            id: judgement.id,
            targetType: judgement.targetType,
            targetId: judgement.targetId,
            dimensions: judgement.dimensions,
            summary: judgement.summary,
            skillPurposeSummary: judgement.skillPurposeSummary ?? null,
            model: judgement.model,
            createdAt: new Date(judgement.createdAt),
          })
        );
    }

    throw new ValidationError(`Unsupported judgement target type: ${targetType}`);
  }
}

interface StoredJudgement {
  id: string;
  targetType: 'proposal' | 'skill' | 'file';
  targetId: string;
  dimensions: Record<string, JudgementDimension>;
  overallRisk?: string;
  summary: string;
  skillPurposeSummary?: string | null;
  model: string | null;
  createdAt: string;
}

function isStoredJudgement(value: unknown, targetId: string): value is StoredJudgement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const judgement = value as StoredJudgement;
  return judgement.targetType === 'skill' && judgement.targetId === targetId;
}
