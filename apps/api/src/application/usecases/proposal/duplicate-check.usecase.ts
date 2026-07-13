import { createHash } from 'crypto';
import { DuplicateCheckInputDto, DuplicateCheckMatchDto, DuplicateCheckResultDto } from '../../dtos/proposal.dto';
import { SkillCatalogPort, CatalogProposalRecord, CatalogSkillVersionRecord } from '../../ports/outbound/skill-catalog.port';
import { SkillId } from '../../../domain/skill/SkillId';

interface NormalizedInput {
  skillId: string | null;
  title: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  entrypoint: string | null;
  fileFingerprints: Array<{ path: string; sha256: string | null }>;
}

export class ProposalDuplicateCheckUseCase {
  constructor(private readonly catalog: SkillCatalogPort) {}

  async execute(input: DuplicateCheckInputDto): Promise<DuplicateCheckResultDto> {
    const normalized = this.normalize(input);
    const submittedContentDigest = this.computeContentDigest(normalized);

    const exactDuplicateProposal = submittedContentDigest
      ? await this.catalog.findProposalByContentDigest(submittedContentDigest)
      : null;
    const exactDuplicateSkill = submittedContentDigest
      ? await this.catalog.findPublishedSkillByContentDigest(submittedContentDigest)
      : null;

    const skillIdCollision = await this.checkSkillIdCollision(normalized.skillId);

    const similarMatches: DuplicateCheckMatchDto[] = [];
    if (!exactDuplicateProposal && !exactDuplicateSkill) {
      const candidateProposals = await this.loadCandidateProposals(normalized.skillId);
      const candidateSkills = await this.loadCandidateSkills(normalized.skillId);
      const scoredProposals = candidateProposals.map((proposal) => this.scoreMatch(normalized, proposal, 'proposal'));
      const scoredSkills = candidateSkills.map((skill) => this.scoreMatch(normalized, skill, 'skill'));
      similarMatches.push(...scoredProposals, ...scoredSkills);
      similarMatches.sort((a, b) => b.similarityScore - a.similarityScore);
    }

    const topMatches = similarMatches.slice(0, 5).filter((match) => match.similarityScore >= 0.25);
    const resolutionOptions = await this.buildResolutionOptions(normalized, skillIdCollision, exactDuplicateSkill);

    return {
      submittedContentDigest,
      exactDuplicateProposalId: exactDuplicateProposal?.id ?? null,
      exactDuplicateSkillId: exactDuplicateSkill?.skillId ?? null,
      similarMatches: topMatches,
      skillIdCollision,
      resolutionOptions,
      note:
        'This is a pre-submission hint. Duplicate checks are informational only; submission is not blocked. A final content check happens after files are attached via the proposal status endpoint. Ask the user which resolution option to use before submitting.',
    };
  }

  private async buildResolutionOptions(
    input: NormalizedInput,
    skillIdCollision: DuplicateCheckResultDto['skillIdCollision'],
    exactDuplicateSkill: { skillId: string; version: string } | null
  ): Promise<DuplicateCheckResultDto['resolutionOptions']> {
    const options: DuplicateCheckResultDto['resolutionOptions'] = [];

    if (skillIdCollision.exists && skillIdCollision.existingSkillId) {
      options.push({
        strategy: 'create_new_version',
        label: 'Create a new draft version of the existing skill',
        description: `Keep skillId '${skillIdCollision.existingSkillId}'. When an admin converts the proposal, it will be appended as a new draft version of the existing skill.`,
        suggestedSkillId: skillIdCollision.existingSkillId,
        requiresAdminAction: false,
      });
      options.push({
        strategy: 'request_admin_update',
        label: 'Request an admin to update the existing skill directly',
        description: `Instead of creating a new proposal, an admin can review and update the published skill '${skillIdCollision.existingSkillId}'. This requires admin access and is not triggered by a proposal submit.`,
        suggestedSkillId: skillIdCollision.existingSkillId,
        requiresAdminAction: true,
      });
    }

    const baseId = slugify(input.title);
    let suggestedId = baseId;
    let fallbackCounter = 1;
    while (await this.skillIdExists(suggestedId)) {
      fallbackCounter += 1;
      suggestedId = `${baseId}-${fallbackCounter}`;
      if (fallbackCounter > 100) {
        suggestedId = `${baseId}-${Date.now()}`;
        break;
      }
    }

    const createNewLabel = skillIdCollision.exists
      ? 'Create a new skill under a different id'
      : exactDuplicateSkill
        ? 'Create a new skill under a different id (current content already exists as a published skill)'
        : 'Create a new skill';

    options.push({
      strategy: 'create_new_skill',
      label: createNewLabel,
      description: `Use the suggested skillId '${suggestedId}'. This creates a brand new skill if converted by an admin.`,
      suggestedSkillId: suggestedId,
      requiresAdminAction: false,
    });

    return options;
  }

  private async skillIdExists(skillId: string): Promise<boolean> {
    try {
      SkillId.create(skillId);
    } catch {
      return true;
    }
    const existing = await this.catalog.getLatestVersion(skillId);
    return existing !== null;
  }


  private normalize(input: DuplicateCheckInputDto): NormalizedInput {
    return {
      skillId: input.skillId?.trim().toLowerCase() ?? null,
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category.trim().toLowerCase(),
      tags: (input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      capabilities: (input.capabilities ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean),
      entrypoint: input.entrypoint?.trim() ?? null,
      fileFingerprints: (input.files ?? []).map((file) => ({
        path: file.path.trim(),
        sha256: file.sha256?.trim() ?? null,
      })),
    };
  }

  private computeContentDigest(input: NormalizedInput): string | null {
    if (input.fileFingerprints.length === 0) {
      return null;
    }
    const hash = createHash('sha256');
    hash.update(input.skillId ?? '');
    hash.update('|');
    hash.update(input.title);
    hash.update('|');
    hash.update(input.description);
    hash.update('|');
    hash.update(input.category);
    hash.update('|');
    hash.update(input.tags.join(','));
    hash.update('|');
    hash.update(input.capabilities.join(','));
    hash.update('|');
    hash.update(input.entrypoint ?? '');
    hash.update('|');
    const parts = input.fileFingerprints.map((file) => `${file.path}:${file.sha256 ?? ''}`).sort();
    hash.update(parts.join(','));
    return hash.digest('hex');
  }

  private async checkSkillIdCollision(skillId: string | null): Promise<DuplicateCheckResultDto['skillIdCollision']> {
    if (!skillId) {
      return { exists: false, existingSkillId: null, note: 'No explicit skillId provided.' };
    }
    try {
      SkillId.create(skillId);
    } catch {
      return { exists: false, existingSkillId: null, note: `Provided skillId '${skillId}' is invalid.` };
    }
    const existing = await this.catalog.getLatestVersion(skillId);
    if (existing) {
      return {
        exists: true,
        existingSkillId: skillId,
        note: `A skill with id '${skillId}' already exists. Converting this proposal would create a new draft version of that skill.`,
      };
    }
    return { exists: false, existingSkillId: null, note: `Skill id '${skillId}' is available.` };
  }

  private async loadCandidateProposals(excludeSkillId: string | null): Promise<CatalogProposalRecord[]> {
    const result = await this.catalog.listProposals({ limit: 200 });
    return result.items.filter(
      (proposal) => !excludeSkillId || proposal.skillId !== excludeSkillId
    );
  }

  private async loadCandidateSkills(excludeSkillId: string | null): Promise<CatalogSkillVersionRecord[]> {
    const result = await this.catalog.listLatestSkillVersions({ publishedOnly: true, limit: 200 });
    return result.items.filter((version) => version.skillId !== excludeSkillId);
  }

  private scoreMatch(
    input: NormalizedInput,
    candidate: CatalogProposalRecord | CatalogSkillVersionRecord,
    kind: 'proposal' | 'skill'
  ): DuplicateCheckMatchDto {
    const isSkill = kind === 'skill';
    const candidateTags = isSkill ? (candidate as CatalogSkillVersionRecord).tags : (candidate as CatalogProposalRecord).tags;
    const candidateCapabilities = isSkill ? (candidate as CatalogSkillVersionRecord).capabilities : (candidate as CatalogProposalRecord).capabilities;
    const candidateEntrypoint = isSkill ? (candidate as CatalogSkillVersionRecord).entrypoint : (candidate as CatalogProposalRecord).entrypoint ?? null;

    const titleScore = jaccardSimilarity(tokenize(input.title), tokenize(candidate.title));
    const descriptionScore = jaccardSimilarity(tokenize(input.description), tokenize(candidate.description));
    const tagScore = jaccardSimilarity(new Set(input.tags), new Set(candidateTags));
    const capabilityScore = jaccardSimilarity(new Set(input.capabilities), new Set(candidateCapabilities));
    const categoryScore = input.category === candidate.category ? 1 : 0;

    const weightedScore =
      titleScore * 0.25 +
      descriptionScore * 0.35 +
      tagScore * 0.15 +
      capabilityScore * 0.15 +
      categoryScore * 0.1;

    const matchedOn: string[] = [];
    if (titleScore > 0.3) matchedOn.push('title');
    if (descriptionScore > 0.3) matchedOn.push('description');
    if (tagScore > 0.3) matchedOn.push('tags');
    if (capabilityScore > 0.3) matchedOn.push('capabilities');
    if (categoryScore === 1) matchedOn.push('category');

    const candidateId = isSkill ? (candidate as CatalogSkillVersionRecord).skillId : (candidate as CatalogProposalRecord).id;
    const candidateSkillId = isSkill ? (candidate as CatalogSkillVersionRecord).skillId : (candidate as CatalogProposalRecord).skillId;

    const base: DuplicateCheckMatchDto = {
      kind,
      id: candidateId,
      skillId: candidateSkillId,
      title: candidate.title,
      description: truncate(candidate.description, 240),
      category: candidate.category,
      similarityScore: roundScore(weightedScore),
      matchedOn,
      differences: {
        title: titleScore >= 0.9 ? 'very similar title' : titleScore > 0 ? 'different title' : undefined,
        description: descriptionScore >= 0.9 ? 'very similar description' : descriptionScore > 0 ? 'different description' : undefined,
        tags: diffSets(input.tags, candidateTags),
        capabilities: diffSets(input.capabilities, candidateCapabilities),
        entrypoint:
          input.entrypoint && candidateEntrypoint
            ? input.entrypoint === candidateEntrypoint
              ? 'same entrypoint'
              : `different entrypoint (existing: ${candidateEntrypoint})`
            : undefined,
      },
    };

    if (isSkill) {
      base.version = (candidate as CatalogSkillVersionRecord).version;
      base.status = (candidate as CatalogSkillVersionRecord).status;
    } else {
      base.status = (candidate as CatalogProposalRecord).status;
    }

    return base;
  }
}

function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}0-9]+/gu) ?? [];
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((value) => b.has(value)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function diffSets(
  submitted: string[],
  existing: string[]
): { shared: string[]; onlyInSubmitted: string[]; onlyInExisting: string[] } {
  const a = new Set(submitted);
  const b = new Set(existing);
  return {
    shared: [...a].filter((value) => b.has(value)).sort(),
    onlyInSubmitted: [...a].filter((value) => !b.has(value)).sort(),
    onlyInExisting: [...b].filter((value) => !a.has(value)).sort(),
  };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
