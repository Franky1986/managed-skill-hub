import {
  AutoPublishCategoryCheckInput,
  AutoPublishCategoryCheckResult,
  SkillJudgerPort,
  JudgementTarget,
} from '../../../application/ports/outbound/judger.port';
import {
  Judgement,
  JudgementDimension,
  JudgementRisk,
  NO_JUDGE_AVAILABLE_RISK,
} from '../../../domain/judgement/Judgement';

export class NoopSkillJudger implements SkillJudgerPort {
  async judge(target: JudgementTarget): Promise<Judgement> {
    return Judgement.create({
      targetType: target.type,
      targetId: target.id,
      dimensions: {
        harmful: dimension(JudgementRisk.LOW, 'Noop judger: no harmful content detected'),
        promptInjection: dimension(JudgementRisk.LOW, 'Noop judger: no prompt injection detected'),
        dataExfiltration: dimension(
          JudgementRisk.LOW,
          'Noop judger: no data exfiltration detected'
        ),
        policyViolation: dimension(JudgementRisk.LOW, 'Noop judger: no policy violation detected'),
        qualityFit: dimension(JudgementRisk.LOW, 'Noop judger: content appears aligned with the target purpose'),
      },
      summary:
        'No judgement was performed by a real LLM. This result is placeholder-only and should be treated as unreviewed.',
      overallRisk: NO_JUDGE_AVAILABLE_RISK,
      skillPurposeSummary: target.type === 'skill' ? `Skill purpose: ${target.title}.` : null,
      model: 'noop',
    });
  }

  async classifyAutoPublishCategory(input: AutoPublishCategoryCheckInput): Promise<AutoPublishCategoryCheckResult> {
    return {
      blocked: false,
      matchedCategory: null,
      reason: `Noop classifier: auto-publish category check did not block proposal ${input.proposalId}.`,
      model: 'noop',
    };
  }
}

function dimension(risk: JudgementRisk, reason: string): JudgementDimension {
  return { risk, score: riskScore(risk), reason };
}

function riskScore(risk: JudgementRisk): number {
  switch (risk) {
    case JudgementRisk.LOW:
      return 0;
    case JudgementRisk.MEDIUM:
      return 0.33;
    case JudgementRisk.HIGH:
      return 0.66;
    case JudgementRisk.CRITICAL:
      return 1;
    default:
      // exhaustive check keeps the return type number
      return 0;
  }
}
