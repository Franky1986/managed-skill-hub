import { Judgement, JudgementOverallRisk, NO_JUDGE_AVAILABLE_RISK, JudgementRisk } from '../../../domain/judgement/Judgement';

export const REVIEW_LABELS = [
  'safe',
  'needs_review',
  'contains_executable',
  'external_dependency',
  'sensitive_input',
  'prompt_injection_risk',
  'download_only',
] as const;

export type ReviewLabel = (typeof REVIEW_LABELS)[number];

export interface ProposalReviewMetadata {
  latestJudgementRisk: JudgementOverallRisk | null;
  labels: ReviewLabel[];
  latestJudgementId: string | null;
  latestJudgedAt: Date | null;
}

export function deriveProposalReviewMetadata(input: {
  title: string;
  description: string;
  entrypoint?: string | null;
  tags?: string[];
  capabilities?: string[];
  judgements: Judgement[];
  files: Array<{ path: string; mimeType: string }>;
}): ProposalReviewMetadata {
  const latestJudgement = input.judgements[input.judgements.length - 1] ?? null;
  const latestJudgementRisk = highestOverallRisk(input.judgements);
  const latestJudgementId = latestJudgement?.id ?? null;
  const latestJudgedAt = latestJudgement?.createdAt ?? null;

  const containsExecutable = input.files.some((file) => isExecutableFile(file.path, file.mimeType));
  const promptInjectionRisk = input.judgements.some((judgement) =>
    hasRiskAtLeast(judgement.dimensions.promptInjection?.risk, JudgementRisk.MEDIUM)
  );

  const textCorpus = [
    input.title,
    input.description,
    input.entrypoint ?? '',
    ...(input.tags ?? []),
    ...(input.capabilities ?? []),
    ...input.files.map((file) => `${file.path} ${file.mimeType}`),
    ...input.judgements.flatMap((judgement) => [
      judgement.summary,
      ...Object.values(judgement.dimensions).map((dimension) => dimension.reason),
    ]),
  ]
    .join('\n')
    .toLowerCase();

  const externalDependency = /(^|[\s_/.-])(dependency|dependencies|npm|pnpm|yarn|pip|poetry|gem|cargo|docker|brew|apt|curl|wget|package\.json|requirements(\.txt)?|install|download)([\s_/.-]|$)/i.test(
    textCorpus
  );
  const sensitiveInput = /(^|[\s_/.-])(token|password|secret|api[_-]?key|credential|credentials|bearer|cookie|auth|oauth|session)([\s_/.-]|$)/i.test(
    textCorpus
  );
  const downloadOnly =
    input.files.length > 0 &&
    input.files.every((file) => !isTextLikeFile(file.path, file.mimeType) && !isExecutableFile(file.path, file.mimeType));

  const needsReview =
    latestJudgementRisk === null ||
    latestJudgementRisk === NO_JUDGE_AVAILABLE_RISK ||
    hasRiskAtLeast(latestJudgementRisk, JudgementRisk.MEDIUM) ||
    containsExecutable ||
    promptInjectionRisk ||
    externalDependency ||
    sensitiveInput;

  const labels = REVIEW_LABELS.filter((label) => {
    switch (label) {
      case 'safe':
        return !needsReview;
      case 'needs_review':
        return needsReview;
      case 'contains_executable':
        return containsExecutable;
      case 'external_dependency':
        return externalDependency;
      case 'sensitive_input':
        return sensitiveInput;
      case 'prompt_injection_risk':
        return promptInjectionRisk;
      case 'download_only':
        return downloadOnly;
      default:
        return false;
    }
  });

  return {
    latestJudgementRisk,
    labels,
    latestJudgementId,
    latestJudgedAt,
  };
}

function highestOverallRisk(judgements: Judgement[]): JudgementOverallRisk | null {
  if (judgements.length === 0) {
    return null;
  }
  return judgements
    .map((judgement) => judgement.overallRisk)
    .sort((left, right) => riskRank(right) - riskRank(left))[0] ?? null;
}

function hasRiskAtLeast(risk: JudgementRisk | undefined | null, threshold: JudgementRisk): boolean {
  if (!risk) {
    return false;
  }
  return riskRank(risk) >= riskRank(threshold);
}

function riskRank(risk: JudgementOverallRisk): number {
  if (risk === NO_JUDGE_AVAILABLE_RISK) {
    return 0;
  }

  switch (risk) {
    case JudgementRisk.LOW:
      return 0;
    case JudgementRisk.MEDIUM:
      return 1;
    case JudgementRisk.HIGH:
      return 2;
    case JudgementRisk.CRITICAL:
      return 3;
    default:
      return 0;
  }
}

function isExecutableFile(filePath: string, mimeType: string): boolean {
  const normalizedPath = filePath.toLowerCase();
  const normalizedMimeType = mimeType.toLowerCase();
  return (
    /\.(sh|bash|zsh|fish|py|js|jsx|ts|tsx|mjs|cjs|rb|ps1|bat|cmd|exe|bin|jar|com)$/i.test(normalizedPath) ||
    normalizedPath.endsWith('/dockerfile') ||
    normalizedPath === 'dockerfile' ||
    normalizedMimeType.includes('x-sh') ||
    normalizedMimeType.includes('x-python') ||
    normalizedMimeType.includes('javascript') ||
    normalizedMimeType.includes('typescript') ||
    normalizedMimeType.includes('x-msdos-program') ||
    normalizedMimeType.includes('x-executable')
  );
}

function isTextLikeFile(filePath: string, mimeType: string): boolean {
  const normalizedPath = filePath.toLowerCase();
  const normalizedMimeType = mimeType.toLowerCase();
  return (
    normalizedMimeType.startsWith('text/') ||
    normalizedMimeType.includes('json') ||
    normalizedMimeType.includes('xml') ||
    normalizedMimeType.includes('yaml') ||
    normalizedMimeType.includes('csv') ||
    /\.(md|markdown|txt|ya?ml|json|csv|tsv|html|css|js|jsx|ts|tsx|py|rb|sh|bash|zsh|sql)$/i.test(normalizedPath)
  );
}
