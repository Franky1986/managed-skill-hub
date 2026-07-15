import { promises as fs } from 'fs';
import path from 'path';
import { AuditLogPort } from '../../../../application/ports/outbound/audit.port';
import { SkillCatalogPort } from '../../../../application/ports/outbound/skill-catalog.port';
import { AuditEntry } from '../../../../domain/audit/AuditEntry';
import { StorageError } from '../../../../domain/errors';

export class FileSystemAuditLog implements AuditLogPort {
  constructor(
    private readonly dataDir: string,
    private readonly catalog?: SkillCatalogPort
  ) {}

  private auditDir(): string {
    return path.join(this.dataDir, 'audit');
  }

  private fileName(skillId?: string | null, proposalId?: string | null): string {
    const key = skillId ?? proposalId ?? 'global';
    return path.join(this.auditDir(), `${key}.jsonl`);
  }

  async append(entry: AuditEntry): Promise<void> {
    const dir = this.auditDir();
    await fs.mkdir(dir, { recursive: true });
    const file = this.fileName(entry.skillId, entry.proposalId);
    const line = JSON.stringify({
      id: entry.id,
      skillId: entry.skillId,
      skillVersion: entry.skillVersion,
      proposalId: entry.proposalId,
      action: entry.action,
      actor: entry.actor,
      actorPrincipalId: entry.actorPrincipalId,
      actorDisplayName: entry.actorDisplayName,
      actorClientId: entry.actorClientId,
      before: entry.before,
      after: entry.after,
      createdAt: entry.createdAt.toISOString(),
    }) + '\n';
    await fs.appendFile(file, line);
    await this.catalog?.upsertAuditEntry(entry);
  }

  async findBySkillId(skillId: string): Promise<AuditEntry[]> {
    return this.readLines(this.fileName(skillId, null));
  }

  async findByProposalId(proposalId: string): Promise<AuditEntry[]> {
    // Entries such as `convert_proposal` carry both identifiers and are stored
    // under the skill file because `append()` chooses the skill key first.
    // Read all append-only files and filter by the persisted proposalId so
    // proposal status/history does not lose those cross-aggregate actions.
    const entries = await this.findAll();
    return entries.filter((entry) => entry.proposalId === proposalId);
  }

  async findAll(): Promise<AuditEntry[]> {
    try {
      const entries = await fs.readdir(this.auditDir(), { withFileTypes: true });
      const all: AuditEntry[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        all.push(...await this.readLines(path.join(this.auditDir(), entry.name)));
      }
      return all.sort(compareAuditEntries);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new StorageError(`Failed to read audit logs: ${(err as Error).message}`);
    }
  }

  private async readLines(file: string): Promise<AuditEntry[]> {
    try {
      const raw = await fs.readFile(file, 'utf-8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const parsed = JSON.parse(line);
          return AuditEntry.create({
            id: parsed.id,
            skillId: parsed.skillId ?? null,
            skillVersion: parsed.skillVersion ?? null,
            proposalId: parsed.proposalId ?? null,
            action: parsed.action,
            actor: parsed.actor,
            actorPrincipalId: parsed.actorPrincipalId ?? null,
            actorDisplayName: parsed.actorDisplayName ?? null,
            actorClientId: parsed.actorClientId ?? null,
            before: parsed.before ?? null,
            after: parsed.after ?? null,
            createdAt: new Date(parsed.createdAt),
          });
        });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new StorageError(`Failed to read audit log: ${(err as Error).message}`);
    }
  }
}

function compareAuditEntries(left: AuditEntry, right: AuditEntry): number {
  const byDate = left.createdAt.getTime() - right.createdAt.getTime();
  if (byDate !== 0) return byDate;
  return left.id.localeCompare(right.id);
}
