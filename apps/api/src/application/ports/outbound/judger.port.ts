import { Judgement } from '../../../domain/judgement/Judgement';

export interface JudgementTarget {
  type: 'proposal' | 'skill' | 'file';
  id: string;
  title: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface AutoPublishCategoryCheckInput {
  proposalId: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  entrypoint: string | null;
  excludedCategories: string[];
  content: string;
}

export interface AutoPublishCategoryCheckResult {
  blocked: boolean;
  matchedCategory: string | null;
  reason: string;
  model: string | null;
}

export interface SemanticDuplicateInput {
  submittedTitle: string;
  submittedDescription: string;
  submittedCategory: string;
  submittedTags: string[];
  submittedCapabilities: string[];
  submittedContent: string;
  candidateTitle: string;
  candidateDescription: string;
  candidateCategory: string;
  candidateTags: string[];
  candidateCapabilities: string[];
  candidateContent: string;
}

export interface SemanticDuplicateResult {
  similarityScore: number;
  reason: string;
  model: string | null;
}

export interface SkillJudgerPort {
  judge(target: JudgementTarget): Promise<Judgement>;
  classifyAutoPublishCategory?(input: AutoPublishCategoryCheckInput): Promise<AutoPublishCategoryCheckResult>;
  assessDuplicateSimilarity?(input: SemanticDuplicateInput): Promise<SemanticDuplicateResult>;
}
