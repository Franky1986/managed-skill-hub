import { SkillQueryPort } from '../../ports/inbound/skill-query.port';

export class ListSkillsUseCase {
  constructor(private readonly query: SkillQueryPort) {}

  async execute(category?: string, tags: string[] = [], limit = 50, offset = 0) {
    return this.query.listPublishedSummaries(category, tags, limit, offset);
  }
}
