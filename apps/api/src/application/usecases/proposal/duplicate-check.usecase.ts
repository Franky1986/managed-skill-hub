import { createHash } from 'crypto';
import { Proposal } from '../../../domain/proposal/Proposal';
import { SkillId } from '../../../domain/skill/SkillId';
import { DuplicateCheckInputDto, DuplicateCheckMatchDto, DuplicateCheckResultDto } from '../../dtos/proposal.dto';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SemanticDuplicateInput, SkillJudgerPort } from '../../ports/outbound/judger.port';
import { CatalogProposalRecord, CatalogSkillVersionRecord, SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';

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

interface ContentRef {
  text: string;
  path: string;
}

export interface ProposalDuplicateAssessment {
  result: DuplicateCheckResultDto;
  semanticCheck: {
    status: 'not_required' | 'completed' | 'unavailable';
    reason: string | null;
  };
}

export class ProposalDuplicateCheckUseCase {
  constructor(
    private readonly catalog: SkillCatalogPort,
    private readonly storage?: SkillFileStoragePort,
    private readonly scanner?: FileScannerPort,
    private readonly judger?: SkillJudgerPort,
  ) {}

  async execute(input: DuplicateCheckInputDto): Promise<DuplicateCheckResultDto> {
    return this.evaluate(this.normalize(input), null);
  }

  async executeForProposal(proposal: Proposal): Promise<ProposalDuplicateAssessment> {
    const normalized = this.normalize({
      skillId: proposal.skillId ?? undefined,
      title: proposal.title,
      description: proposal.description,
      category: proposal.category,
      tags: proposal.tags,
      capabilities: proposal.capabilities,
      entrypoint: proposal.entrypoint ?? undefined,
      files: proposal.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    });
    const result = await this.evaluate(normalized, proposal.id);

    if (
      result.exactDuplicateProposalId
      || result.exactDuplicateSkillId
      || result.skillIdCollision.exists
    ) {
      return { result, semanticCheck: { status: 'not_required', reason: null } };
    }

    const candidates = result.similarMatches
      .filter((match) => match.kind === 'skill' && match.similarityScore >= 0.4)
      .slice(0, 3);
    if (candidates.length === 0) {
      return { result, semanticCheck: { status: 'not_required', reason: null } };
    }
    if (!this.storage || !this.scanner || !this.judger?.assessDuplicateSimilarity) {
      return {
        result,
        semanticCheck: {
          status: 'unavailable',
          reason: 'Semantic duplicate comparison is required for a strong metadata candidate but no capable judger is configured.',
        },
      };
    }

    const submittedContent = await this.readProposalEntrypoint(proposal);
    if (!submittedContent) {
      return {
        result,
        semanticCheck: {
          status: 'unavailable',
          reason: 'Semantic duplicate comparison could not read the submitted proposal entrypoint.',
        },
      };
    }

    try {
      const semanticMatches = await Promise.all(
        candidates.map(async (match) => {
          const candidateContent = await this.readPublishedSkillEntrypoint(match);
          if (!candidateContent) {
            throw new Error('Published candidate entrypoint is unavailable.');
          }
          const semantic = await this.judger!.assessDuplicateSimilarity!(
            this.buildSemanticInput(normalized, submittedContent, match, candidateContent)
          );
          return {
            id: match.id,
            score: roundScore(semantic.similarityScore),
            reason: semantic.reason,
            comparedFilePath: candidateContent.path,
            model: semantic.model,
          };
        })
      );

      const enrichedMatches = result.similarMatches.map((match) => {
        const semantic = semanticMatches.find((candidate) => candidate.id === match.id);
        if (!semantic) {
          return match;
        }
        return {
          ...match,
          similarityScore: roundScore(Math.max(match.similarityScore, semantic.score)),
          semanticSimilarity: {
            score: semantic.score,
            reason: semantic.reason,
            comparedFilePath: semantic.comparedFilePath,
            model: semantic.model,
          },
        };
      });
      enrichedMatches.sort((a, b) => b.similarityScore - a.similarityScore);

      return {
        result: { ...result, similarMatches: enrichedMatches },
        semanticCheck: { status: 'completed', reason: null },
      };
    } catch {
      return {
        result,
        semanticCheck: {
          status: 'unavailable',
          reason: 'Semantic duplicate comparison failed for at least one strong published-skill candidate.',
        },
      };
    }
  }

  private async evaluate(normalized: NormalizedInput, excludeProposalId: string | null): Promise<DuplicateCheckResultDto> {
    const submittedContentDigest = this.computeContentDigest(normalized);
    const exactDuplicateProposal = submittedContentDigest
      ? await this.catalog.findProposalByContentDigest(submittedContentDigest, excludeProposalId ?? undefined)
      : null;
    const exactDuplicateSkill = submittedContentDigest
      ? await this.catalog.findPublishedSkillByContentDigest(submittedContentDigest)
      : null;
    const skillIdCollision = await this.checkSkillIdCollision(normalized.skillId);

    const similarMatches: DuplicateCheckMatchDto[] = [];
    if (!exactDuplicateProposal && !exactDuplicateSkill) {
      const [candidateProposals, candidateSkills] = await Promise.all([
        this.loadCandidateProposals(excludeProposalId),
        this.loadCandidateSkills(normalized.skillId),
      ]);
      similarMatches.push(
        ...candidateProposals.map((proposal) => this.scoreMatch(normalized, proposal, 'proposal')),
        ...candidateSkills.map((skill) => this.scoreMatch(normalized, skill, 'skill')),
      );
      similarMatches.sort((a, b) => b.similarityScore - a.similarityScore);
    }

    const resolutionOptions = await this.buildResolutionOptions(normalized, skillIdCollision, exactDuplicateSkill);
    return {
      submittedContentDigest,
      exactDuplicateProposalId: exactDuplicateProposal?.id ?? null,
      exactDuplicateSkillId: exactDuplicateSkill?.skillId ?? null,
      similarMatches: similarMatches.slice(0, 5).filter((match) => match.similarityScore >= 0.25),
      skillIdCollision,
      resolutionOptions,
      note:
        'This pre-submission hint uses metadata and file fingerprints only. It never reads stored proposal content. Submission is not blocked; ask the user which resolution option to use before submitting. Finalized proposals may receive an internal semantic comparison against published skills during auto-publish evaluation.',
    };
  }

  private buildSemanticInput(
    input: NormalizedInput,
    submittedContent: ContentRef,
    match: DuplicateCheckMatchDto,
    candidateContent: ContentRef
  ): SemanticDuplicateInput {
    const tagDiff = match.differences.tags;
    const capabilityDiff = match.differences.capabilities;
    return {
      submittedTitle: input.title,
      submittedDescription: input.description,
      submittedCategory: input.category,
      submittedTags: input.tags,
      submittedCapabilities: input.capabilities,
      submittedContent: submittedContent.text,
      candidateTitle: match.title,
      candidateDescription: match.description,
      candidateCategory: match.category,
      candidateTags: [...(tagDiff?.shared ?? []), ...(tagDiff?.onlyInExisting ?? [])],
      candidateCapabilities: [
        ...(capabilityDiff?.shared ?? []),
        ...(capabilityDiff?.onlyInExisting ?? []),
      ],
      candidateContent: candidateContent.text,
    };
  }

  private async readProposalEntrypoint(proposal: Proposal): Promise<ContentRef | null> {
    if (!this.storage || !this.scanner) {
      return null;
    }
    const filePath = proposal.entrypoint ?? 'SKILL.md';
    const stored = await this.storage.readProposalFile(proposal.id, filePath);
    return stored ? this.extractText(stored.content, stored.mimeType, filePath) : null;
  }

  private async readPublishedSkillEntrypoint(match: DuplicateCheckMatchDto): Promise<ContentRef | null> {
    if (!this.storage || !this.scanner || !match.skillId || !match.version) {
      return null;
    }
    const filePath = match.entrypoint ?? 'SKILL.md';
    const stored = await this.storage.readSkillFile(match.skillId, match.version, filePath);
    return stored ? this.extractText(stored.content, stored.mimeType, filePath) : null;
  }

  private async extractText(content: Buffer, mimeType: string, filePath: string): Promise<ContentRef | null> {
    if (!this.scanner) {
      return null;
    }
    try {
      const scanned = await this.scanner.scan(content, mimeType, filePath);
      return scanned.text.trim().length > 0 ? { text: scanned.text, path: filePath } : null;
    } catch {
      return null;
    }
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
        description: `Keep skillId '${skillIdCollision.existingSkillId}'. This is the recommended option when the new package is intended as a revision of the existing skill. Auto-publish is not possible here; an admin must later convert the proposal into a new draft version of '${skillIdCollision.existingSkillId}' and then approve and publish it.`,
        suggestedSkillId: skillIdCollision.existingSkillId,
        requiresAdminAction: true,
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
    return (await this.catalog.getLatestVersion(skillId)) !== null;
  }

  private normalize(input: DuplicateCheckInputDto): NormalizedInput {
    return {
      skillId: input.skillId?.trim().toLowerCase() ?? null,
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category.trim().toLowerCase(),
      tags: (input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      capabilities: (input.capabilities ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean),
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
    hash.update(input.fileFingerprints.map((file) => `${file.path}:${file.sha256 ?? ''}`).sort().join(','));
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
    return existing
      ? {
          exists: true,
          existingSkillId: skillId,
          note: `A skill with id '${skillId}' already exists. Converting this proposal would create a new draft version of that skill.`,
        }
      : { exists: false, existingSkillId: null, note: `Skill id '${skillId}' is available.` };
  }

  private async loadCandidateProposals(excludeProposalId: string | null): Promise<CatalogProposalRecord[]> {
    const result = await this.catalog.listProposals({ status: 'open', limit: 200 });
    return result.items.filter((proposal) => proposal.id !== excludeProposalId);
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
    const candidateCapabilities = isSkill
      ? (candidate as CatalogSkillVersionRecord).capabilities
      : (candidate as CatalogProposalRecord).capabilities;
    const candidateEntrypoint = isSkill
      ? (candidate as CatalogSkillVersionRecord).entrypoint
      : (candidate as CatalogProposalRecord).entrypoint ?? null;
    const titleScore = jaccardSimilarity(tokenize(input.title), tokenize(candidate.title));
    const descriptionScore = jaccardSimilarity(tokenize(input.description), tokenize(candidate.description));
    const tagScore = jaccardSimilarity(new Set(input.tags), new Set(candidateTags));
    const capabilityScore = jaccardSimilarity(new Set(input.capabilities), new Set(candidateCapabilities));
    const categoryScore = input.category === candidate.category ? 1 : 0;
    const weightedScore =
      titleScore * 0.25
      + descriptionScore * 0.35
      + tagScore * 0.15
      + capabilityScore * 0.15
      + categoryScore * 0.1;
    const matchedOn: string[] = [];
    if (titleScore > 0.3) matchedOn.push('title');
    if (descriptionScore > 0.3) matchedOn.push('description');
    if (tagScore > 0.3) matchedOn.push('tags');
    if (capabilityScore > 0.3) matchedOn.push('capabilities');
    if (categoryScore === 1) matchedOn.push('category');

    const base: DuplicateCheckMatchDto = {
      kind,
      id: isSkill ? (candidate as CatalogSkillVersionRecord).skillId : (candidate as CatalogProposalRecord).id,
      skillId: isSkill ? (candidate as CatalogSkillVersionRecord).skillId : (candidate as CatalogProposalRecord).skillId,
      title: candidate.title,
      description: truncate(candidate.description, 240),
      category: candidate.category,
      entrypoint: candidateEntrypoint,
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
  return new Set(text.toLowerCase().match(/[\p{L}0-9]+/gu) ?? []);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((value) => b.has(value)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function diffSets(submitted: string[], existing: string[]) {
  const a = new Set(submitted);
  const b = new Set(existing);
  return {
    shared: [...a].filter((value) => b.has(value)).sort(),
    onlyInSubmitted: [...a].filter((value) => !b.has(value)).sort(),
    onlyInExisting: [...b].filter((value) => !a.has(value)).sort(),
  };
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
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
