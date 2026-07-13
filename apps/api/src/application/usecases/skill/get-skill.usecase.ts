import { NotFoundError } from '../../../domain/errors';
import { SkillQueryPort } from '../../ports/inbound/skill-query.port';

export class GetSkillUseCase {
  constructor(private readonly query: SkillQueryPort) {}

  async execute(id: string) {
    const detail = await this.query.getSkillDetail(id);
    if (!detail) {
      throw new NotFoundError(`Skill ${id} not found`);
    }
    return detail;
  }
}
