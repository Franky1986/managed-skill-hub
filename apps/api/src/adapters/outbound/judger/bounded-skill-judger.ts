import { AutoPublishCategoryCheckInput, AutoPublishCategoryCheckResult, SemanticDuplicateInput, SemanticDuplicateResult, SkillJudgerPort, JudgementTarget } from '../../../application/ports/outbound/judger.port';
import { Judgement } from '../../../domain/judgement/Judgement';

/** A process-wide FIFO limiter shared by every operation of one judger instance. */
export class BoundedSkillJudger implements SkillJudgerPort {
  readonly modelIdentity: string | null;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  readonly classifyAutoPublishCategory?: (input: AutoPublishCategoryCheckInput) => Promise<AutoPublishCategoryCheckResult>;
  readonly assessDuplicateSimilarity?: (input: SemanticDuplicateInput) => Promise<SemanticDuplicateResult>;

  constructor(private readonly delegate: SkillJudgerPort, private readonly maxConcurrency: number) {
    this.modelIdentity = delegate.modelIdentity ?? null;
    if (delegate.classifyAutoPublishCategory) this.classifyAutoPublishCategory = (input) => this.run(() => delegate.classifyAutoPublishCategory!(input));
    if (delegate.assessDuplicateSimilarity) this.assessDuplicateSimilarity = (input) => this.run(() => delegate.assessDuplicateSimilarity!(input));
  }

  async judge(target: JudgementTarget): Promise<Judgement> { return this.run(() => this.delegate.judge(target)); }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await operation(); } finally { this.release(); }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) { this.active += 1; return; }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const waiter = this.waiting.shift();
    if (waiter) { waiter(); return; }
    this.active -= 1;
  }
}
