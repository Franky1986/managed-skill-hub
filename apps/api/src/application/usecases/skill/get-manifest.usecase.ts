import { NotFoundError } from '../../../domain/errors';
import { SkillQueryPort } from '../../ports/inbound/skill-query.port';

export class GetManifestUseCase {
  constructor(private readonly query: SkillQueryPort) {}

  async execute(skillId: string, version?: string) {
    const manifest = await this.query.getManifest(skillId, version);
    if (!manifest) {
      throw new NotFoundError(`Manifest for skill ${skillId} not found`);
    }
    return manifest;
  }
}
