import {
  AutoPublishCategoryCheckInput,
  AutoPublishCategoryCheckResult,
  JudgementTarget,
  SemanticDuplicateInput,
  SemanticDuplicateResult,
  SkillJudgerPort,
} from '../../../application/ports/outbound/judger.port';
import { Judgement } from '../../../domain/judgement/Judgement';
import { JudgerProtocolError, JudgerTimeoutError, JudgerUnavailableError } from '../../../domain/errors';

/**
 * Trust boundary for operator-supplied adapters.  Their Error objects are not
 * trusted: provider messages often contain raw upstream payloads and must not
 * reach Fastify/Pino, audit storage, or runtime events.
 */
export class SafeExternalSkillJudger implements SkillJudgerPort {
  readonly modelIdentity: string | null | undefined;
  readonly classifyAutoPublishCategory?: (input: AutoPublishCategoryCheckInput) => Promise<AutoPublishCategoryCheckResult>;
  readonly assessDuplicateSimilarity?: (input: SemanticDuplicateInput) => Promise<SemanticDuplicateResult>;

  constructor(private readonly delegate: SkillJudgerPort) {
    this.modelIdentity = delegate.modelIdentity;
    const classify = delegate.classifyAutoPublishCategory;
    if (classify) {
      this.classifyAutoPublishCategory = (input) => this.call(() => classify.call(delegate, input));
    }
    const assessDuplicate = delegate.assessDuplicateSimilarity;
    if (assessDuplicate) {
      this.assessDuplicateSimilarity = (input) => this.call(() => assessDuplicate.call(delegate, input));
    }
  }

  async judge(target: JudgementTarget): Promise<Judgement> {
    return this.call(() => this.delegate.judge(target));
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof JudgerUnavailableError || error instanceof JudgerTimeoutError || error instanceof JudgerProtocolError) throw error;
      const name = String((error as { name?: unknown })?.name ?? '');
      if (name === 'AbortError' || name === 'TimeoutError') throw new JudgerTimeoutError('External judger timed out');
      throw new JudgerUnavailableError('External judger request failed');
    }
  }
}
