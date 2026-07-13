import type { JudgementRecord } from '../api/judgements';

export type JudgementOverallRisk = JudgementRecord['overallRisk'];
export type TranslateFn = (
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
    fallback?: string
) => string;

export function formatOverallRiskLabel(
    risk: JudgementOverallRisk | null | undefined,
    translate: TranslateFn,
    fallback = 'n/a'
): string {
    if (!risk) {
        return fallback;
    }
    return isNoJudgeAvailable(risk) ? translate('judgement.notJudged') : risk;
}

export function isNoJudgeAvailable(risk: JudgementOverallRisk | null | undefined): risk is 'no_judge_available' {
    return risk === 'no_judge_available';
}

export function noJudgeHint(translate: TranslateFn): string {
    return translate('judgement.noJudgeHint');
}
