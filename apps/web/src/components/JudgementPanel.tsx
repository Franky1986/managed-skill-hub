import type { JudgementRecord } from '../api/judgements';
import { formatLocalDateTime } from '../lib/formatLocalDateTime';
import { formatOverallRiskLabel, type TranslateFn } from '../lib/judgement';
import { LanguageCode } from '../i18n';
import { translate } from '../i18n/messages';

type TranslationParams = Parameters<TranslateFn>[1];

export function JudgementPanel({
    judgements,
    title,
    latestLabel,
    previousLabel,
    findingsLabel,
    noJudgementsLabel,
    modelLabel,
    riskLabel,
    historyLabel,
    language,
}: {
    judgements: JudgementRecord[];
    title: string;
    latestLabel: string;
    previousLabel: (count: number) => string;
    findingsLabel: string;
    noJudgementsLabel: string;
    modelLabel: string;
    riskLabel: string;
    historyLabel: string;
    language: LanguageCode;
}) {
    const translateByLanguage = (key: string, params?: TranslationParams, fallback?: string) =>
        translate(language, key, params, fallback);
    const sorted = [...judgements].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latest = sorted[0] ?? null;
    const history = sorted.slice(1);

    return (
        <section className="rounded border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
            <h2 className="text-sm font-semibold text-indigo-950">{title}</h2>
            {!latest ? (
                <p className="mt-2 text-sm text-gray-600">{noJudgementsLabel}</p>
            ) : (
                <div className="mt-2 space-y-2 rounded bg-white p-3">
                    <JudgementCard
                        judgement={latest}
                        heading={latestLabel}
                        findingsLabel={findingsLabel}
                        modelLabel={modelLabel}
                        riskLabel={riskLabel}
                        language={language}
                        translate={translateByLanguage}
                    />
                    {history.length > 0 && (
                        <details className="rounded border border-indigo-100">
                            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-indigo-800">
                                {previousLabel(history.length)}
                            </summary>
                            <div className="space-y-2 border-t p-3">
                                {history.map((judgement) => (
                                    <JudgementCard
                                        key={judgement.id}
                                        judgement={judgement}
                                        heading={historyLabel}
                                        findingsLabel={findingsLabel}
                                        modelLabel={modelLabel}
                                        riskLabel={riskLabel}
                                        language={language}
                                        translate={translateByLanguage}
                                    />
                                ))}
                            </div>
                        </details>
                    )}
                </div>
            )}
        </section>
    );
}

function JudgementCard({
    judgement,
    heading,
    findingsLabel,
    modelLabel,
    riskLabel,
    language,
    translate: translateFn,
}: {
    judgement: JudgementRecord;
    heading: string;
    findingsLabel: string;
    modelLabel: string;
    riskLabel: string;
    language: LanguageCode;
    translate: TranslateFn;
}) {
    return (
        <article className="rounded border border-indigo-100 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-medium text-gray-900">{heading}</p>
                <p className="text-xs text-gray-500">{formatLocalDateTime(judgement.createdAt)}</p>
            </div>
            {judgement.skillPurposeSummary && (
                <p className="mt-2 text-sm text-gray-800">{judgement.skillPurposeSummary}</p>
            )}
            <p className="mt-2 text-sm text-gray-700">{judgement.summary}</p>
            <p className="mt-2 text-xs text-gray-600">
                {modelLabel}: {judgement.model ?? 'n/a'} · {riskLabel}: {formatOverallRiskLabel(judgement.overallRisk, translateFn)}
            </p>
            <JudgementBadgeRow judgement={judgement} className="mt-2" language={language} />
            {renderJudgementFindings(judgement, findingsLabel)}
        </article>
    );
}

export function JudgementBadgeRow({
    judgement,
    className = '',
    language = 'en',
}: {
    judgement: JudgementRecord;
    className?: string;
    language?: LanguageCode;
}) {
    const translateByLanguage = (key: string, params?: TranslationParams, fallback?: string) =>
        translate(language, key, params, fallback);
    return (
        <div className={`flex flex-wrap gap-2 ${className}`}>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(judgement.overallRisk)}`}>
                overall: {formatOverallRiskLabel(judgement.overallRisk, translateByLanguage)}
            </span>
            {Object.entries(judgement.dimensions).map(([name, dimension]) => (
                <span
                    key={name}
                    title={`${dimension.risk} - ${dimension.reason}`}
                    className={`inline-flex cursor-help items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        riskBadgeClass(dimension.risk)
                    }`}
                >
                    {name}: {dimension.risk}
                </span>
            ))}
        </div>
    );
}

function riskBadgeClass(risk: string): string {
    return risk === 'critical'
        ? 'bg-red-100 text-red-800'
        : risk === 'high'
            ? 'bg-orange-100 text-orange-800'
            : risk === 'medium'
                ? 'bg-yellow-100 text-yellow-800'
                : risk === 'no_judge_available'
                    ? 'bg-gray-100 text-gray-700 border border-gray-300'
                    : 'bg-green-100 text-green-800';
}

function renderJudgementFindings(judgement: JudgementRecord, title: string): JSX.Element | null {
    const findings = Object.entries(judgement.dimensions)
        .filter(([, dimension]) => dimension.risk !== 'low' && dimension.reason.trim().length > 0);
    if (findings.length === 0) {
        return null;
    }

    return (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
            <p className="font-medium">{title}</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
                {findings.map(([name, dimension]) => (
                    <li key={name}>
                        <span className="font-medium">{name}: {dimension.risk}</span> {dimension.reason}
                    </li>
                ))}
            </ul>
        </div>
    );
}
