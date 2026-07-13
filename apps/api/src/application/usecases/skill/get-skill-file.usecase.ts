import { NotFoundError } from '../../../domain/errors';
import { SkillQueryPort } from '../../ports/inbound/skill-query.port';

export class GetSkillFileUseCase {
  constructor(private readonly query: SkillQueryPort) {}

  async execute(skillId: string, fileId: string, version?: string) {
    const file = await this.query.getFile(skillId, fileId, version);
    if (!file) {
      throw new NotFoundError(`File ${fileId} for skill ${skillId} not found`);
    }
    return file;
  }
}
