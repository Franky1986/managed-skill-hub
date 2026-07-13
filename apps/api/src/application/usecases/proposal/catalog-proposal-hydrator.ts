import {
  Judgement,
  JudgementOverallRisk,
  JudgementRisk,
  NO_JUDGE_AVAILABLE_RISK,
} from '../../../domain/judgement/Judgement';
import { Proposal, ProposalFile } from '../../../domain/proposal/Proposal';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';

export async function buildProposalAggregateFromCatalog(
  catalog: SkillCatalogPort,
  proposalId: string
): Promise<Proposal | null> {
  const proposal = await catalog.getProposal(proposalId);
  if (!proposal) {
    return null;
  }

  const [files, judgements] = await Promise.all([
    catalog.listProposalFiles(proposalId),
    catalog.listProposalJudgements(proposalId),
  ]);

  return Proposal.rehydrate({
    id: proposal.id,
    skillId: proposal.skillId,
    title: proposal.title,
    description: proposal.description,
    category: proposal.category,
    tags: proposal.tags,
    capabilities: proposal.capabilities,
    entrypoint: proposal.entrypoint,
    files: files.map((file) =>
      ProposalFile.create({
        id: file.id,
        path: file.path,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
      })
    ),
    judgements: judgements.map((judgement) =>
      Judgement.create({
        id: judgement.id,
        targetType: judgement.targetType,
        targetId: judgement.targetId,
        overallRisk: normalizeOverallRisk(
          judgement.overallRisk,
          judgement.model,
          judgement.dimensions
        ),
        dimensions: judgement.dimensions,
        summary: judgement.summary,
        skillPurposeSummary: judgement.skillPurposeSummary,
        model: judgement.model,
        createdAt: judgement.createdAt,
      })
    ),
    status: proposal.status,
    submittedBy: proposal.submittedBy,
    submittedByPrincipalId: proposal.submittedByPrincipalId,
    submittedViaClientId: proposal.submittedViaClientId,
    createdAt: proposal.createdAt,
    rejectionReason: proposal.rejectionReason,
    contentDigest: proposal.contentDigest,
  });
}

function normalizeOverallRisk(
  rawRisk: string,
  model: string | null,
  dimensions: Judgement['dimensions']
): JudgementOverallRisk {
  if (rawRisk === NO_JUDGE_AVAILABLE_RISK) {
    return NO_JUDGE_AVAILABLE_RISK;
  }

  if (model === 'noop') {
    return NO_JUDGE_AVAILABLE_RISK;
  }

  if (rawRisk === JudgementRisk.LOW || rawRisk === JudgementRisk.MEDIUM || rawRisk === JudgementRisk.HIGH || rawRisk === JudgementRisk.CRITICAL) {
    return rawRisk;
  }

  return inferOverallRiskFromDimensions(dimensions);
}

function parseRiskValue(value: unknown): JudgementOverallRisk | null {
  if (value === JudgementRisk.LOW || value === JudgementRisk.MEDIUM || value === JudgementRisk.HIGH || value === JudgementRisk.CRITICAL) {
    return value;
  }
  if (value === NO_JUDGE_AVAILABLE_RISK) {
    return value;
  }
  return null;
}

function inferOverallRiskFromDimensions(dimensions: Judgement['dimensions']): JudgementOverallRisk {
  const risks = Object.values(dimensions).map((dimension) => dimension.risk);
  if (risks.some((risk) => risk === JudgementRisk.CRITICAL)) {
    return JudgementRisk.CRITICAL;
  }
  if (risks.some((risk) => risk === JudgementRisk.HIGH)) {
    return JudgementRisk.HIGH;
  }
  if (risks.some((risk) => risk === JudgementRisk.MEDIUM)) {
    return JudgementRisk.MEDIUM;
  }
  const parsedRisk = risks.map(parseRiskValue).find((risk): risk is JudgementOverallRisk => risk !== null);
  return parsedRisk ?? JudgementRisk.LOW;
}
