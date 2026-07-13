import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import {
  ExtractedSkillFileContent,
  ExtractSkillFileContentUseCase,
} from './extract-skill-file-content.usecase';

export class ReextractSkillFileUseCase {
  constructor(
    private readonly extractor: ExtractSkillFileContentUseCase,
    private readonly audit: AuditLogPort
  ) {}

  async execute(
    skillId: string,
    filePath: string,
    actor: string,
    options?: { version?: string }
  ): Promise<ExtractedSkillFileContent> {
    const extracted = await this.extractor.execute(skillId, filePath, {
      version: options?.version,
      includeUnpublished: true,
      forceRefresh: true,
    });

    await this.audit.append(
      AuditEntry.create({
        skillId,
        skillVersion: options?.version ?? null,
        action: 'reextract_skill_file',
        actor,
        after: {
          filePath,
          extractedBy: extracted.extractedBy,
        },
      })
    );

    return extracted;
  }
}
