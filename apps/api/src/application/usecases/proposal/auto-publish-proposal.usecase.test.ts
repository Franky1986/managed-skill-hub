import { describe, expect, it, vi } from 'vitest';
import { Proposal, ProposalFile } from '../../../domain/proposal/Proposal';
import { AutoPublishProposalUseCase } from './auto-publish-proposal.usecase';
import { Judgement, JudgementRisk, NO_JUDGE_AVAILABLE_RISK } from '../../../domain/judgement/Judgement';
import { SkillId } from '../../../domain/skill/SkillId';

function greenJudgement(targetType: 'proposal' | 'file', targetId: string, model = 'test-model'): Judgement {
  return Judgement.create({
    targetType,
    targetId,
    dimensions: {
      harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'ok' },
      promptInjection: { risk: JudgementRisk.LOW, score: 0, reason: 'ok' },
      dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'ok' },
      policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'ok' },
      qualityFit: { risk: JudgementRisk.LOW, score: 0, reason: 'ok' },
    },
    model,
  });
}

function noopJudgement(targetType: 'proposal' | 'file', targetId: string): Judgement {
  return greenJudgement(targetType, targetId, 'noop');
}

function noJudgeAvailableJudgement(targetType: 'proposal' | 'file', targetId: string): Judgement {
  return Judgement.create({
    targetType,
    targetId,
    dimensions: {
      harmful: { risk: JudgementRisk.LOW, score: 0, reason: 'not judged' },
      promptInjection: { risk: JudgementRisk.LOW, score: 0, reason: 'not judged' },
      dataExfiltration: { risk: JudgementRisk.LOW, score: 0, reason: 'not judged' },
      policyViolation: { risk: JudgementRisk.LOW, score: 0, reason: 'not judged' },
      qualityFit: { risk: JudgementRisk.LOW, score: 0, reason: 'not judged' },
    },
    overallRisk: NO_JUDGE_AVAILABLE_RISK,
    summary: 'No judgement was performed.',
    model: 'noop',
  });
}

describe('AutoPublishProposalUseCase', () => {
  it('auto-publishes a finalized fully green proposal when classifier allows it', async () => {
    const proposal = Proposal.create({
      id: 'proposal-1',
      title: 'Video skill',
      description: 'A safe video helper',
      category: 'media',
      tags: ['video'],
      capabilities: ['trim'],
      entrypoint: 'SKILL.md',
      submittedBy: 'agent',
    })
      .addFile(ProposalFile.create({
        id: 'SKILL.md',
        path: 'SKILL.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        sha256: 'abc',
      }))
      .finalizeUpload()
      .addJudgement(greenJudgement('proposal', 'proposal-1'))
      .addJudgement(greenJudgement('file', 'proposal-1:SKILL.md'));

    const append = vi.fn(async () => undefined);
    const convertProposal = vi.fn(async () => ({
      id: SkillId.create('video-skill'),
      getAllVersions: () => [{ version: '1.0.0' }],
    }));
    const reviewSkill = {
      submitForReview: vi.fn(async () => ({})),
      approve: vi.fn(async () => ({})),
      publish: vi.fn(async () => ({})),
    };

    const useCase = new AutoPublishProposalUseCase(
      {
        findProposalById: vi.fn(async () => proposal),
      } as never,
      {
        readProposalFile: vi.fn(async () => ({
          mimeType: 'text/markdown',
          content: Buffer.from('# hello'),
        })),
      } as never,
      {
        append,
        findByProposalId: vi.fn(async () => []),
      } as never,
      {
        scan: vi.fn(async () => ({ text: '# hello', metadata: {} })),
      } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({
          blocked: false,
          matchedCategory: null,
          reason: 'not excluded',
          model: 'test-model',
        })),
      } as never,
      {
        convertProposal,
      } as never,
      reviewSkill as never,
      {
        enabled: true,
        excludedCategories: ['security', 'network'],
        autoApproveWithoutJudger: false,
      }
    );

    const result = await useCase.execute(proposal.id);

    expect(result.enabled).toBe(true);
    expect(result.eligible).toBe(true);
    expect(result.autoPublished).toBe(true);
    expect(result.publishedSkillId).toBe('video-skill');
    expect(convertProposal).toHaveBeenCalledWith(
      proposal.id,
      'system:auto-publish',
      expect.stringContaining('Automatic proposal conversion')
    );
    expect(reviewSkill.submitForReview).toHaveBeenCalledWith('video-skill', '1.0.0', 'system:auto-publish');
    expect(reviewSkill.approve).toHaveBeenCalledWith('video-skill', '1.0.0', 'system:auto-publish');
    expect(reviewSkill.publish).toHaveBeenCalledWith('video-skill', '1.0.0', 'system:auto-publish');
    expect(append).toHaveBeenCalled();
  });

  it('blocks auto-publish for noop judgements unless AUTO_APPROVE_WITHOUT_JUDGER is enabled', async () => {
    const proposal = Proposal.create({
      id: 'proposal-3',
      title: 'Noop gate test',
      description: 'Should require explicit allow-flag for auto publish.',
      category: 'media',
      tags: ['video'],
      capabilities: ['trim'],
      entrypoint: 'SKILL.md',
      submittedBy: 'agent',
    })
      .addFile(ProposalFile.create({
        id: 'SKILL.md',
        path: 'SKILL.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        sha256: 'abc',
      }))
      .finalizeUpload()
      .addJudgement(noopJudgement('proposal', 'proposal-3'))
      .addJudgement(noopJudgement('file', 'proposal-3:SKILL.md'));

    const append = vi.fn(async () => undefined);
    const autoPublishProposal = new AutoPublishProposalUseCase(
      {
        findProposalById: vi.fn(async () => proposal),
      } as never,
      {
        readProposalFile: vi.fn(async () => ({
          mimeType: 'text/markdown',
          content: Buffer.from('# hello'),
        })),
      } as never,
      {
        append,
        findByProposalId: vi.fn(async () => []),
      } as never,
      {
        scan: vi.fn(async () => ({ text: '# hello', metadata: {} })),
      } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({
          blocked: false,
          matchedCategory: null,
          reason: 'not excluded',
          model: 'test-model',
        })),
      } as never,
      {
        convertProposal: vi.fn(async () => {
          throw new Error('should not convert when noop blocked');
        }),
      } as never,
      {
        submitForReview: vi.fn(),
        approve: vi.fn(),
        publish: vi.fn(),
      } as never,
      {
        enabled: true,
        excludedCategories: ['security', 'network'],
        autoApproveWithoutJudger: false,
      },
      {
        getProposal: vi.fn(async () => null),
        findProposalByContentDigest: vi.fn(async () => null),
        findPublishedSkillByContentDigest: vi.fn(async () => null),
      } as never
    );

    const result = await autoPublishProposal.execute(proposal.id);

    expect(result.eligible).toBe(false);
    expect(result.blockedReason).toBe('non_green_judgement');
    expect(result.classifierReason).toContain('AUTO_APPROVE_WITHOUT_JUDGER=true');
    expect(append).toHaveBeenCalled();

    const useCaseWithFlag = new AutoPublishProposalUseCase(
      {
        findProposalById: vi.fn(async () => proposal),
      } as never,
      {
        readProposalFile: vi.fn(async () => ({
          mimeType: 'text/markdown',
          content: Buffer.from('# hello'),
        })),
      } as never,
      {
        append: vi.fn(async () => undefined),
        findByProposalId: vi.fn(async () => []),
      } as never,
      {
        scan: vi.fn(async () => ({ text: '# hello', metadata: {} })),
      } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({
          blocked: false,
          matchedCategory: null,
          reason: 'not excluded',
          model: 'test-model',
        })),
      } as never,
      {
        convertProposal: vi.fn(async () => ({
          id: SkillId.create('video-skill'),
          getAllVersions: () => [{ version: '1.0.0' }],
        })),
      } as never,
      {
        submitForReview: vi.fn(async () => ({})),
        approve: vi.fn(async () => ({})),
        publish: vi.fn(async () => ({})),
      } as never,
      {
        enabled: true,
        excludedCategories: ['security', 'network'],
        autoApproveWithoutJudger: true,
      },
      {
        getProposal: vi.fn(async () => null),
        findProposalByContentDigest: vi.fn(async () => null),
        findPublishedSkillByContentDigest: vi.fn(async () => null),
      } as never
    );

    const enabledResult = await useCaseWithFlag.execute(proposal.id);
    expect(enabledResult.autoPublished).toBe(true);
    expect(enabledResult.publishedSkillId).toBe('video-skill');
  });


  it('allows no_judge_available only when AUTO_APPROVE_WITHOUT_JUDGER is enabled', async () => {
    const proposal = Proposal.create({
      id: 'proposal-no-judge',
      title: 'No judge available gate test',
      description: 'Should require explicit allow-flag for not-judged auto publish.',
      category: 'media',
      tags: ['video'],
      capabilities: ['trim'],
      entrypoint: 'SKILL.md',
      submittedBy: 'agent',
    })
      .addFile(ProposalFile.create({
        id: 'SKILL.md',
        path: 'SKILL.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        sha256: 'abc',
      }))
      .finalizeUpload()
      .addJudgement(noJudgeAvailableJudgement('proposal', 'proposal-no-judge'))
      .addJudgement(noJudgeAvailableJudgement('file', 'proposal-no-judge:SKILL.md'));

    const blockedUseCase = new AutoPublishProposalUseCase(
      { findProposalById: vi.fn(async () => proposal) } as never,
      { readProposalFile: vi.fn(async () => ({ mimeType: 'text/markdown', content: Buffer.from('# hello') })) } as never,
      { append: vi.fn(async () => undefined), findByProposalId: vi.fn(async () => []) } as never,
      { scan: vi.fn(async () => ({ text: '# hello', metadata: {} })) } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({
          blocked: false,
          matchedCategory: null,
          reason: 'not excluded',
          model: 'test-model',
        })),
      } as never,
      { convertProposal: vi.fn(async () => { throw new Error('should not convert when not judged is blocked'); }) } as never,
      { submitForReview: vi.fn(), approve: vi.fn(), publish: vi.fn() } as never,
      { enabled: true, excludedCategories: ['security', 'network'], autoApproveWithoutJudger: false },
      { getProposal: vi.fn(async () => null), findProposalByContentDigest: vi.fn(async () => null), findPublishedSkillByContentDigest: vi.fn(async () => null) } as never
    );

    const blocked = await blockedUseCase.execute(proposal.id);
    expect(blocked.autoPublished).toBe(false);
    expect(blocked.blockedReason).toBe('non_green_judgement');
    expect(blocked.classifierReason).toContain('AUTO_APPROVE_WITHOUT_JUDGER=true');

    const allowedUseCase = new AutoPublishProposalUseCase(
      { findProposalById: vi.fn(async () => proposal) } as never,
      { readProposalFile: vi.fn(async () => ({ mimeType: 'text/markdown', content: Buffer.from('# hello') })) } as never,
      { append: vi.fn(async () => undefined), findByProposalId: vi.fn(async () => []) } as never,
      { scan: vi.fn(async () => ({ text: '# hello', metadata: {} })) } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({
          blocked: false,
          matchedCategory: null,
          reason: 'not excluded',
          model: 'test-model',
        })),
      } as never,
      {
        convertProposal: vi.fn(async () => ({
          id: SkillId.create('video-skill'),
          getAllVersions: () => [{ version: '1.0.0' }],
        })),
      } as never,
      { submitForReview: vi.fn(async () => ({})), approve: vi.fn(async () => ({})), publish: vi.fn(async () => ({})) } as never,
      { enabled: true, excludedCategories: ['security', 'network'], autoApproveWithoutJudger: true },
      { getProposal: vi.fn(async () => null), findProposalByContentDigest: vi.fn(async () => null), findPublishedSkillByContentDigest: vi.fn(async () => null) } as never
    );

    const allowed = await allowedUseCase.execute(proposal.id);
    expect(allowed.autoPublished).toBe(true);
    expect(allowed.publishedSkillId).toBe('video-skill');
  });

  it('blocks auto-publish when the category classifier blocks it', async () => {
    const proposal = Proposal.create({
      id: 'proposal-2',
      title: 'Firewall script',
      description: 'Automates local firewall changes',
      category: 'automation',
      tags: ['network'],
      capabilities: ['configure'],
      entrypoint: 'SKILL.md',
      submittedBy: 'agent',
    })
      .addFile(ProposalFile.create({
        id: 'SKILL.md',
        path: 'SKILL.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        sha256: 'abc',
      }))
      .finalizeUpload()
      .addJudgement(greenJudgement('proposal', 'proposal-2'))
      .addJudgement(greenJudgement('file', 'proposal-2:SKILL.md'));

    const convertProposal = vi.fn();
    const useCase = new AutoPublishProposalUseCase(
      {
        findProposalById: vi.fn(async () => proposal),
      } as never,
      {
        readProposalFile: vi.fn(async () => ({
          mimeType: 'text/markdown',
          content: Buffer.from('# firewall'),
        })),
      } as never,
      {
        append: vi.fn(async () => undefined),
        findByProposalId: vi.fn(async () => []),
      } as never,
      {
        scan: vi.fn(async () => ({ text: '# firewall', metadata: {} })),
      } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({
          blocked: true,
          matchedCategory: 'network',
          reason: 'Touches network/security automation.',
          model: 'test-model',
        })),
      } as never,
      {
        convertProposal,
      } as never,
      {
        submitForReview: vi.fn(),
        approve: vi.fn(),
        publish: vi.fn(),
      } as never,
      {
        enabled: true,
        excludedCategories: ['security', 'network'],
        autoApproveWithoutJudger: false,
      }
    );

    const result = await useCase.execute(proposal.id);

    expect(result.enabled).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.blockedReason).toBe('category_blocked');
    expect(result.autoPublished).toBe(false);
    expect(convertProposal).not.toHaveBeenCalled();
  });
  it('blocks auto-publish when a semantic duplicate exceeds the similarity threshold', async () => {
    const proposal = Proposal.create({
      id: 'proposal-dup',
      title: 'Video skill clone',
      description: 'A safe video helper that is very similar to an existing skill.',
      category: 'media',
      tags: ['video'],
      capabilities: ['trim'],
      entrypoint: 'SKILL.md',
      submittedBy: 'agent',
    })
      .addFile(ProposalFile.create({
        id: 'SKILL.md',
        path: 'SKILL.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        sha256: 'abc',
      }))
      .finalizeUpload()
      .addJudgement(greenJudgement('proposal', 'proposal-dup'))
      .addJudgement(greenJudgement('file', 'proposal-dup:SKILL.md'));

    const convertProposal = vi.fn();
    const duplicateCheck = {
      executeForProposal: vi.fn(async () => ({
        semanticCheck: { status: 'completed', reason: null },
        result: {
        submittedContentDigest: null,
        exactDuplicateProposalId: null,
        exactDuplicateSkillId: null,
        similarMatches: [
          {
            kind: 'skill',
            id: 'existing-video-skill:1.0.0',
            skillId: 'existing-video-skill',
            title: 'Existing Video Skill',
            description: 'A safe video helper',
            category: 'media',
            tags: ['video'],
            similarityScore: 0.85,
            matchedOn: ['title', 'description', 'tags'],
            differences: {},
          },
        ],
        skillIdCollision: { exists: false, existingSkillId: null, note: '' },
        resolutionOptions: [],
        note: '',
        },
      })),
    };

    const useCase = new AutoPublishProposalUseCase(
      {
        findProposalById: vi.fn(async () => proposal),
      } as never,
      {
        readProposalFile: vi.fn(async () => ({
          mimeType: 'text/markdown',
          content: Buffer.from('# hello'),
        })),
      } as never,
      {
        append: vi.fn(async () => undefined),
        findByProposalId: vi.fn(async () => []),
      } as never,
      {
        scan: vi.fn(async () => ({ text: '# hello', metadata: {} })),
      } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({
          blocked: false,
          matchedCategory: null,
          reason: 'not excluded',
          model: 'test-model',
        })),
      } as never,
      {
        convertProposal,
      } as never,
      {
        submitForReview: vi.fn(),
        approve: vi.fn(),
        publish: vi.fn(),
      } as never,
      {
        enabled: true,
        excludedCategories: ['security', 'network'],
        autoApproveWithoutJudger: false,
        similarityThreshold: 0.7,
      },
      {
        getProposal: vi.fn(async () => null),
        findProposalByContentDigest: vi.fn(async () => null),
        findPublishedSkillByContentDigest: vi.fn(async () => null),
      } as never,
      duplicateCheck as never
    );

    const result = await useCase.execute(proposal.id);

    expect(result.enabled).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.blockedReason).toBe('manual_review_required');
    expect(result.classifierReason).toContain('0.85');
    expect(result.classifierReason).toContain('existing-video-skill');
    expect(convertProposal).not.toHaveBeenCalled();
  });

  it('allows auto-publish when the highest semantic similarity is below the threshold', async () => {
    const proposal = Proposal.create({
      id: 'proposal-unique',
      title: 'Completely unique skill',
      description: 'Nothing like this exists yet.',
      category: 'media',
      tags: ['unique'],
      capabilities: ['trim'],
      entrypoint: 'SKILL.md',
      submittedBy: 'agent',
    })
      .addFile(ProposalFile.create({
        id: 'SKILL.md',
        path: 'SKILL.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        sha256: 'abc',
      }))
      .finalizeUpload()
      .addJudgement(greenJudgement('proposal', 'proposal-unique'))
      .addJudgement(greenJudgement('file', 'proposal-unique:SKILL.md'));

    const convertProposal = vi.fn(async () => ({
      id: SkillId.create('unique-skill'),
      getAllVersions: () => [{ version: '1.0.0' }],
    }));
    const duplicateCheck = {
      executeForProposal: vi.fn(async () => ({
        semanticCheck: { status: 'completed', reason: null },
        result: {
        submittedContentDigest: null,
        exactDuplicateProposalId: null,
        exactDuplicateSkillId: null,
        similarMatches: [
          {
            kind: 'skill',
            id: 'other-skill:1.0.0',
            skillId: 'other-skill',
            title: 'Other Skill',
            description: 'Something else',
            category: 'media',
            tags: ['video'],
            similarityScore: 0.4,
            matchedOn: ['category'],
            differences: {},
          },
        ],
        skillIdCollision: { exists: false, existingSkillId: null, note: '' },
        resolutionOptions: [],
        note: '',
        },
      })),
    };

    const useCase = new AutoPublishProposalUseCase(
      {
        findProposalById: vi.fn(async () => proposal),
      } as never,
      {
        readProposalFile: vi.fn(async () => ({
          mimeType: 'text/markdown',
          content: Buffer.from('# hello'),
        })),
      } as never,
      {
        append: vi.fn(async () => undefined),
        findByProposalId: vi.fn(async () => []),
      } as never,
      {
        scan: vi.fn(async () => ({ text: '# hello', metadata: {} })),
      } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({
          blocked: false,
          matchedCategory: null,
          reason: 'not excluded',
          model: 'test-model',
        })),
      } as never,
      {
        convertProposal,
      } as never,
      {
        submitForReview: vi.fn(async () => ({})),
        approve: vi.fn(async () => ({})),
        publish: vi.fn(async () => ({})),
      } as never,
      {
        enabled: true,
        excludedCategories: ['security', 'network'],
        autoApproveWithoutJudger: false,
        similarityThreshold: 0.7,
      },
      {
        getProposal: vi.fn(async () => null),
        findProposalByContentDigest: vi.fn(async () => null),
        findPublishedSkillByContentDigest: vi.fn(async () => null),
      } as never,
      duplicateCheck as never
    );

    const result = await useCase.execute(proposal.id);

    expect(result.enabled).toBe(true);
    expect(result.eligible).toBe(true);
    expect(result.autoPublished).toBe(true);
    expect(result.publishedSkillId).toBe('unique-skill');
  });

});

describe('AutoPublishProposalUseCase semantic duplicate gate', () => {
  it('blocks auto-publish when semantic duplicate similarity is at or above threshold', async () => {
    const proposal = Proposal.create({
      id: 'proposal-dup',
      title: 'Web scraper',
      description: 'Scrape web pages and extract structured data.',
      category: 'tooling',
      tags: ['agent', 'web'],
      capabilities: ['read', 'scrape'],
      entrypoint: 'SKILL.md',
      submittedBy: 'agent',
    })
      .addFile(ProposalFile.create({
        id: 'SKILL.md',
        path: 'SKILL.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        sha256: 'abc',
      }))
      .finalizeUpload()
      .addJudgement(greenJudgement('proposal', 'proposal-dup'))
      .addJudgement(greenJudgement('file', 'proposal-dup:SKILL.md'));

    const duplicateCheck = {
      executeForProposal: vi.fn().mockResolvedValue({
        semanticCheck: { status: 'completed', reason: null },
        result: {
        submittedContentDigest: null,
        exactDuplicateProposalId: null,
        exactDuplicateSkillId: null,
        similarMatches: [{
          kind: 'skill',
          id: 'existing-web-scraper',
          skillId: 'existing-web-scraper',
          title: 'Existing web scraper',
          description: 'Scrapes web pages.',
          category: 'tooling',
          similarityScore: 0.62,
          matchedOn: ['description'],
          differences: {},
          semanticSimilarity: { score: 0.62, reason: 'Overlapping purpose', comparedFilePath: 'SKILL.md', model: 'test' },
        }],
        skillIdCollision: { exists: false, existingSkillId: null, note: '' },
        resolutionOptions: [],
        note: '',
        },
      }),
    };

    const append = vi.fn(async () => undefined);
    const useCase = new AutoPublishProposalUseCase(
      { findProposalById: vi.fn(async () => proposal) } as never,
      { readProposalFile: vi.fn(async () => ({ mimeType: 'text/markdown', content: Buffer.from('# web scraper') })) } as never,
      { append, findByProposalId: vi.fn(async () => []) } as never,
      { scan: vi.fn(async () => ({ text: '# web scraper', metadata: {} })) } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({ blocked: false, matchedCategory: null, reason: 'not excluded', model: 'test-model' })),
      } as never,
      { convertProposal: vi.fn() } as never,
      { submitForReview: vi.fn(), approve: vi.fn(), publish: vi.fn() } as never,
      { enabled: true, excludedCategories: [], autoApproveWithoutJudger: false, similarityThreshold: 0.5 },
      {
        getProposal: vi.fn(async () => null),
        findProposalByContentDigest: vi.fn(async () => null),
        findPublishedSkillByContentDigest: vi.fn(async () => null),
      } as never,
      duplicateCheck as never,
    );

    const result = await useCase.execute(proposal.id);

    expect(result.eligible).toBe(false);
    expect(result.blockedReason).toBe('manual_review_required');
    expect(result.classifierReason).toContain('Duplicate similarity check blocked auto-publish');
    expect(result.classifierReason).toContain('0.62');
    expect(append).toHaveBeenCalled();
    expect(duplicateCheck.executeForProposal).toHaveBeenCalledTimes(1);
  });

  it('fails closed when semantic duplicate enrichment is unavailable', async () => {
    const proposal = Proposal.create({
      id: 'proposal-semantic-unavailable',
      title: 'Web scraper',
      description: 'Scrape web pages and extract structured data.',
      category: 'tooling',
      tags: ['agent', 'web'],
      capabilities: ['read', 'scrape'],
      entrypoint: 'SKILL.md',
      submittedBy: 'agent',
    })
      .addFile(ProposalFile.create({
        id: 'SKILL.md',
        path: 'SKILL.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        sha256: 'abc',
      }))
      .finalizeUpload()
      .addJudgement(greenJudgement('proposal', 'proposal-semantic-unavailable'))
      .addJudgement(greenJudgement('file', 'proposal-semantic-unavailable:SKILL.md'));

    const duplicateCheck = {
      executeForProposal: vi.fn().mockResolvedValue({
        semanticCheck: { status: 'unavailable', reason: 'Semantic duplicate enrichment is unavailable.' },
        result: {
          submittedContentDigest: null,
          exactDuplicateProposalId: null,
          exactDuplicateSkillId: null,
          similarMatches: [],
          skillIdCollision: { exists: false, existingSkillId: null, note: '' },
          resolutionOptions: [],
          note: '',
        },
      }),
    };
    const convertProposal = vi.fn();
    const useCase = new AutoPublishProposalUseCase(
      { findProposalById: vi.fn(async () => proposal) } as never,
      { readProposalFile: vi.fn(async () => ({ mimeType: 'text/markdown', content: Buffer.from('# web scraper') })) } as never,
      { append: vi.fn(async () => undefined), findByProposalId: vi.fn(async () => []) } as never,
      { scan: vi.fn(async () => ({ text: '# web scraper', metadata: {} })) } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({ blocked: false, matchedCategory: null, reason: 'not excluded', model: 'test-model' })),
      } as never,
      { convertProposal } as never,
      { submitForReview: vi.fn(), approve: vi.fn(), publish: vi.fn() } as never,
      { enabled: true, excludedCategories: [], autoApproveWithoutJudger: false, similarityThreshold: 0.5 },
      {} as never,
      duplicateCheck as never,
    );

    const result = await useCase.execute(proposal.id);

    expect(result.eligible).toBe(false);
    expect(result.blockedReason).toBe('manual_review_required');
    expect(result.classifierReason).toContain('unavailable');
    expect(convertProposal).not.toHaveBeenCalled();
    expect(duplicateCheck.executeForProposal).toHaveBeenCalledTimes(1);
  });
});

describe('AutoPublishProposalUseCase skillId collision gate', () => {
  it('blocks auto-publish when the proposal targets an existing skillId', async () => {
    const proposal = Proposal.create({
      id: 'proposal-collision',
      skillId: 'existing-skill',
      title: 'Existing skill update',
      description: 'A meaningful new version of an existing skill.',
      category: 'tooling',
      tags: ['update'],
      capabilities: ['read'],
      entrypoint: 'SKILL.md',
      submittedBy: 'agent',
    })
      .addFile(ProposalFile.create({
        id: 'SKILL.md',
        path: 'SKILL.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        sha256: 'abc',
      }))
      .finalizeUpload()
      .addJudgement(greenJudgement('proposal', 'proposal-collision'))
      .addJudgement(greenJudgement('file', 'proposal-collision:SKILL.md'));

    const duplicateCheck = {
      executeForProposal: vi.fn().mockResolvedValue({
        semanticCheck: { status: 'not_required', reason: null },
        result: {
        submittedContentDigest: null,
        exactDuplicateProposalId: null,
        exactDuplicateSkillId: null,
        similarMatches: [],
        skillIdCollision: { exists: true, existingSkillId: 'existing-skill', note: '' },
        resolutionOptions: [],
        note: '',
        },
      }),
    };

    const append = vi.fn(async () => undefined);
    const useCase = new AutoPublishProposalUseCase(
      { findProposalById: vi.fn(async () => proposal) } as never,
      { readProposalFile: vi.fn(async () => ({ mimeType: 'text/markdown', content: Buffer.from('# existing skill update') })) } as never,
      { append, findByProposalId: vi.fn(async () => []) } as never,
      { scan: vi.fn(async () => ({ text: '# existing skill update', metadata: {} })) } as never,
      {
        judge: vi.fn(),
        classifyAutoPublishCategory: vi.fn(async () => ({ blocked: false, matchedCategory: null, reason: 'not excluded', model: 'test-model' })),
      } as never,
      { convertProposal: vi.fn() } as never,
      { submitForReview: vi.fn(), approve: vi.fn(), publish: vi.fn() } as never,
      { enabled: true, excludedCategories: [], autoApproveWithoutJudger: false, similarityThreshold: 0.5 },
      {
        getProposal: vi.fn(async () => null),
        findProposalByContentDigest: vi.fn(async () => null),
        findPublishedSkillByContentDigest: vi.fn(async () => null),
      } as never,
      duplicateCheck as never,
    );

    const result = await useCase.execute(proposal.id);

    expect(result.eligible).toBe(false);
    expect(result.blockedReason).toBe('manual_review_required');
    expect(result.classifierReason).toContain('existing-skill');
    expect(result.classifierReason).toContain('new draft version');
    expect(append).toHaveBeenCalled();
  });
});
