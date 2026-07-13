import { JudgementOverallRisk, JudgementRisk } from '../../domain/judgement/Judgement';

export interface JudgementDimensionDto {
  risk: JudgementRisk;
  score: number;
  reason: string;
}

export interface JudgementDto {
  id: string;
  targetType: 'proposal' | 'skill' | 'file';
  targetId: string;
  dimensions: Record<string, JudgementDimensionDto>;
  overallRisk: JudgementOverallRisk;
  summary: string;
  skillPurposeSummary: string | null;
  model: string | null;
  createdAt: Date;
}
