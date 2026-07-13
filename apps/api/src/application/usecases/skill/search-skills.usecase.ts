import { SkillQueryPort, SkillSearchQuery } from '../../ports/inbound/skill-query.port';

export class SearchSkillsUseCase {
  constructor(private readonly query: SkillQueryPort) {}

  async execute(query: SkillSearchQuery) {
    return this.query.search(query);
  }
}
