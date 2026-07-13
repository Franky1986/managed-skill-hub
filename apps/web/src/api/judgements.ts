export interface JudgementDimension {
    risk: 'low' | 'medium' | 'high' | 'critical';
    score: number;
    reason: string;
}

export interface JudgementRecord {
    id: string;
    targetType: 'proposal' | 'skill' | 'file';
    targetId: string;
    dimensions: Record<string, JudgementDimension>;
    overallRisk: 'low' | 'medium' | 'high' | 'critical' | 'no_judge_available';
    summary: string;
    skillPurposeSummary: string | null;
    model: string | null;
    createdAt: string;
}
