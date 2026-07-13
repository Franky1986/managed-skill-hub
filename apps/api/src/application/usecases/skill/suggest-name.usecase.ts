import { SkillId } from '../../../domain/skill/SkillId';
import { NameSuggestionPort } from '../../ports/inbound/name-suggestion.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';

export class SuggestSkillNameUseCase implements NameSuggestionPort {
  constructor(private readonly repo: SkillRepositoryPort) {}

  async suggestSkillId(title: string, _description?: string): Promise<{
    suggestion: string;
    alternatives: string[];
    isAvailable: boolean;
  }> {
    const base = slugify(title);
    const candidates = [base];
    for (let i = 2; i <= 5; i++) {
      candidates.push(`${base}-${i}`);
    }

    const availability: { candidate: string; available: boolean }[] = [];
    for (const candidate of candidates) {
      try {
        SkillId.create(candidate);
        const exists = await this.repo.exists(candidate);
        availability.push({ candidate, available: !exists });
      } catch {
        availability.push({ candidate, available: false });
      }
    }

    const firstAvailable = availability.find((a) => a.available);
    return {
      suggestion: firstAvailable?.candidate ?? candidates[0],
      alternatives: candidates,
      isAvailable: !!firstAvailable,
    };
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 64);
}
