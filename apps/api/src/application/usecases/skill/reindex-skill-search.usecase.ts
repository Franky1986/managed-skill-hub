import { AuditEntry } from '../../../domain/audit/AuditEntry';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';
import { AuditLogPort } from '../../ports/outbound/audit.port';
import { SkillFileStoragePort } from '../../ports/outbound/file-storage.port';
import { SkillRepositoryPort } from '../../ports/outbound/skill-repository.port';
import { SearchDocument, SkillSearchPort } from '../../ports/outbound/search.port';
import { SkillCatalogPort } from '../../ports/outbound/skill-catalog.port';
import { isExtractableArtifact, isTextLikeArtifact } from './public-metadata';

export class ReindexSkillSearchUseCase {
  constructor(
    private readonly repo: SkillRepositoryPort,
    private readonly storage: SkillFileStoragePort,
    private readonly scanner: FileScannerPort,
    private readonly search: SkillSearchPort,
    private readonly audit: AuditLogPort,
    private readonly catalog?: SkillCatalogPort
  ) {}

  async execute(actor: string): Promise<{ indexedVersions: number }> {
    const { items: skills } = await this.repo.findAll();
    const documents: SearchDocument[] = [];

    for (const skill of skills) {
      for (const version of skill.getPublishedVersions()) {
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
            // Extraction errors should not block indexing of the remaining skill body.
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

    await this.catalog?.rebuild(skills);
    await this.search.reindexAll(documents);
    await this.audit.append(
      AuditEntry.create({
        action: 'reindex_search',
        actor,
        after: { indexedVersions: documents.length },
      })
    );

    return { indexedVersions: documents.length };
  }
}
