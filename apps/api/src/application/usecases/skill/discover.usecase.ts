import { SkillQueryPort, DiscoveryResponse } from '../../ports/inbound/skill-query.port';

export class DiscoverUseCase {
  constructor(private readonly query: SkillQueryPort) {}

  async execute(): Promise<DiscoveryResponse> {
    return this.query.discover();
  }
}
