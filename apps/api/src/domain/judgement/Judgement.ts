export enum JudgementRisk {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export const NO_JUDGE_AVAILABLE_RISK = 'no_judge_available' as const;

export type JudgementOverallRisk = JudgementRisk | typeof NO_JUDGE_AVAILABLE_RISK;

export interface JudgementDimension {
  risk: JudgementRisk;
  score: number;
  reason: string;
}

export type JudgementTargetType = 'proposal' | 'skill' | 'file';

export class Judgement {
  private constructor(
    readonly id: string,
  readonly targetType: JudgementTargetType,
  readonly targetId: string,
  readonly dimensions: Record<string, JudgementDimension>,
  readonly overallRisk: JudgementOverallRisk,
  readonly summary: string,
    readonly skillPurposeSummary: string | null,
    readonly model: string | null,
    readonly createdAt: Date
  ) {}

  static create(props: {
    id?: string;
    targetType: JudgementTargetType;
    targetId: string;
    dimensions: Record<string, JudgementDimension>;
    overallRisk?: JudgementOverallRisk;
    summary?: string;
    skillPurposeSummary?: string | null;
    model?: string | null;
    createdAt?: Date;
  }): Judgement {
    const dimensions = props.dimensions;
    if (Object.keys(dimensions).length === 0) {
      throw new Error('Judgement must contain at least one dimension');
    }
    const overallRisk = props.overallRisk ?? computeOverallRisk(Object.values(dimensions));
    return new Judgement(
      props.id ?? generateJudgementId(),
      props.targetType,
      props.targetId,
      dimensions,
      overallRisk,
      props.summary ?? '',
      props.skillPurposeSummary ?? null,
      props.model ?? null,
      props.createdAt ?? new Date()
    );
  }
}

function computeOverallRisk(dimensions: JudgementDimension[]): JudgementRisk {
  if (dimensions.some((d) => d.risk === JudgementRisk.CRITICAL)) {
    return JudgementRisk.CRITICAL;
  }
  if (dimensions.some((d) => d.risk === JudgementRisk.HIGH)) {
    return JudgementRisk.HIGH;
  }
  if (dimensions.some((d) => d.risk === JudgementRisk.MEDIUM)) {
    return JudgementRisk.MEDIUM;
  }
  return JudgementRisk.LOW;
}

function generateJudgementId(): string {
  return `judge-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
