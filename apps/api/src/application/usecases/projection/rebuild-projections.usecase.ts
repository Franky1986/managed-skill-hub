import {
  Judgement,
  JudgementDimension,
  JudgementOverallRisk,
  JudgementRisk,
  JudgementTargetType,
} from '../../../domain/judgement/Judgement';
import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { SearchDocument } from '../../ports/outbound/search.port';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SkillSearchPort } from '../../ports/outbound/search.port';
import { isExtractableArtifact, isTextLikeArtifact } from '../skill/public-metadata';

interface RebuildProjectionsResult {
  skills: number;
  proposals: number;
  publishedVersions: number;
  skillJudgements: number;
  auditEntries: number;
}

export class RebuildProjectionsUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly audit: AuditLogPort,
    private readonly catalog: SkillCatalogPort,
    private readonly search: SkillSearchPort,
    private readonly storage: SkillFileStoragePort,
    private readonly scanner: FileScannerPort
  ) {}

  async execute(actor: string, options?: { clearProjections?: boolean }): Promise<RebuildProjectionsResult> {
    const { items: skills } = await this.repo.findAll();
    const { items: proposals } = await this.repo.findProposals();
    const clearProjections = options?.clearProjections ?? false;

    await this.catalog.rebuild(skills, { clearProjections });

    for (const proposal of proposals) {
      await this.catalog.upsertProposal(proposal);
    }

    let skillJudgementCount = 0;
    let auditEntriesCount = 0;
    const upsertedAuditEntryIds = new Set<string>();

    for (const skill of skills) {
      const entries = await this.audit.findBySkillId(skill.id.toString());
      for (const entry of entries) {
        await this.catalog.upsertAuditEntry(entry);
        upsertedAuditEntryIds.add(entry.id);
        auditEntriesCount += 1;
        const judgement = this.parseAuditedJudgement(entry);
        if (!judgement) {
          continue;
        }
        await this.catalog.upsertSkillJudgement(judgement.skillId, judgement.version, judgement.judgement);
        skillJudgementCount += 1;
      }
    }

    for (const proposal of proposals) {
      const entries = await this.audit.findByProposalId(proposal.id);
      for (const entry of entries) {
        auditEntriesCount += 1;
        if (upsertedAuditEntryIds.has(entry.id)) {
          continue;
        }
        await this.catalog.upsertAuditEntry(entry);
      }
    }

    const documents = await this.buildSearchDocuments(skills);
    await this.search.reindexAll(documents);
    await this.audit.append(
      AuditEntry.create({
        action: 'rebuild_projections',
        actor,
        after: {
          options,
          counts: {
            skills: skills.length,
            proposals: proposals.length,
            publishedVersions: documents.length,
            skillJudgements: skillJudgementCount,
            auditEntries: auditEntriesCount,
          },
          clearProjections,
        },
      })
    );

    return {
      skills: skills.length,
      proposals: proposals.length,
      publishedVersions: documents.length,
      skillJudgements: skillJudgementCount,
      auditEntries: auditEntriesCount,
    };
  }

  private async buildSearchDocuments(skills: Awaited<ReturnType<SkillRepositoryPort['findAll']>>['items']): Promise<SearchDocument[]> {
    const documents: SearchDocument[] = [];
    for (const skill of skills) {
      const publishedVersions = skill.getPublishedVersions();
      for (const version of publishedVersions) {
        const files = await this.storage.listSkillFiles(skill.id.toString(), version.version);
        const extractedChunks: string[] = [];
        for (const file of files) {
          if (!isExtractableArtifact(file.mimeType, file.path)) {
            continue;
          }
          const stored = await this.storage.readSkillFile(skill.id.toString(), version.version, file.path);
          if (!stored) {
            continue;
          }

          if (isTextLikeArtifact(stored.mimeType, file.path)) {
            extractedChunks.push(stored.content.toString('utf-8'));
            continue;
          }

          try {
            const scanned = await this.scanner.scan(stored.content, stored.mimeType, file.path);
            extractedChunks.push(scanned.text);
          } catch {
            // Keep rebuilding other files and versions even if one extraction fails.
          }
        }

        documents.push({
          skillId: skill.id.toString(),
          version: version.version,
          title: version.manifest.title,
          description: version.manifest.description,
          category: version.manifest.category,
          groups: version.manifest.groups,
          capabilities: version.manifest.capabilities,
          body: extractedChunks.join('\n\n'),
          publishedAt: version.publishedAt ?? version.createdAt,
        });
      }
    }
    return documents;
  }

  private parseAuditedJudgement(entry: AuditEntry): { skillId: string; version: string; judgement: Judgement } | null {
    if (entry.action !== 'judge_skill_version' && entry.action !== 'judge_skill_file') {
      return null;
    }
    const after = entry.after as { judgement?: unknown } | null;
    const judgementPayload = after?.judgement;
    if (!judgementPayload || typeof judgementPayload !== 'object' || Array.isArray(judgementPayload)) {
      return null;
    }
    const rawJudgement = judgementPayload as Record<string, unknown>;
    const targetType = parseJudgementTargetType(rawJudgement.targetType);
    if (targetType !== 'skill' && targetType !== 'file') {
      return null;
    }

    const targetId = typeof rawJudgement.targetId === 'string' ? rawJudgement.targetId : null;
    if (!targetId) {
      return null;
    }
    const parsedTarget = parseTargetId(entry.skillId, entry.skillVersion, targetType, targetId);
    if (!parsedTarget) {
      return null;
    }

    const dimensions = parseDimensions(rawJudgement.dimensions);
    if (!dimensions || Object.keys(dimensions).length === 0) {
      return null;
    }

    const createdAt = parseDate(rawJudgement.createdAt);
    try {
      const judgement = Judgement.create({
        id: typeof rawJudgement.id === 'string' ? rawJudgement.id : undefined,
        targetType,
        targetId,
        overallRisk: parseJudgementOverallRisk(rawJudgement.overallRisk),
        dimensions,
        summary: typeof rawJudgement.summary === 'string' ? rawJudgement.summary : '',
        skillPurposeSummary: typeof rawJudgement.skillPurposeSummary === 'string'
          ? rawJudgement.skillPurposeSummary
          : null,
        model: typeof rawJudgement.model === 'string' ? rawJudgement.model : null,
        createdAt,
      });
      return { skillId: parsedTarget.skillId, version: parsedTarget.version, judgement };
    } catch {
      return null;
    }
  }
}

function parseDimensions(raw: unknown): Record<string, JudgementDimension> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const dimensions: Record<string, JudgementDimension> = {};
  for (const [name, dimension] of Object.entries(raw)) {
    if (!dimension || typeof dimension !== 'object' || Array.isArray(dimension)) {
      return null;
    }
    const rawDimension = dimension as Record<string, unknown>;
    const risk = parseJudgementRisk(rawDimension.risk);
    const score = typeof rawDimension.score === 'number' ? rawDimension.score : null;
    const reason = typeof rawDimension.reason === 'string' ? rawDimension.reason : null;
    if (!risk || score === null || reason === null) {
      return null;
    }
    dimensions[name] = { risk, score, reason };
  }
  return dimensions;
}

function parseJudgementTargetType(value: unknown): JudgementTargetType | null {
  if (value === 'proposal' || value === 'skill' || value === 'file') {
    return value;
  }
  return null;
}

function parseTargetId(
  skillId: string | null,
  version: string | null,
  targetType: JudgementTargetType,
  targetId: string
): { skillId: string; version: string } | null {
  if (!skillId || !version) {
    return null;
  }

  if (targetType === 'skill') {
    return { skillId, version };
  }

  if (!targetId.startsWith(`${skillId}:${version}:`)) {
    return null;
  }
  return { skillId, version };
}

function parseDate(value: unknown): Date {
  if (typeof value === 'string' && value.trim().length > 0) {
    return new Date(value);
  }
  return new Date();
}

function parseJudgementRisk(value: unknown): JudgementRisk | null {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') {
    return value as JudgementRisk;
  }
  return null;
}

function parseJudgementOverallRisk(value: unknown): JudgementOverallRisk | undefined {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical' || value === 'no_judge_available') {
    return value as JudgementOverallRisk;
  }
  return undefined;
}
