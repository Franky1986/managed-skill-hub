import { AuditLogPort } from '../../../../application/ports/outbound/audit.port';
import { SkillCatalogPort } from '../../../../application/ports/outbound/skill-catalog.port';
import { AuditEntry } from '../../../../domain/audit/AuditEntry';
import { StorageError } from '../../../../domain/errors';
import { ContentDb, insertDoNothingClause } from '../../persistence/database/content-db';

interface AuditRow {
  id: string;
  skill_id: string | null;
  skill_version: string | null;
  proposal_id: string | null;
  action: string;
  actor: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

export class DatabaseAuditLog implements AuditLogPort {
  constructor(
    private readonly contentDb: ContentDb,
    private readonly catalog?: SkillCatalogPort
  ) {}

  async append(entry: AuditEntry): Promise<void> {
    try {
      await this.contentDb.execute(`
        INSERT INTO content_audit_entries (
          id, skill_id, skill_version, proposal_id, action, actor, before_json, after_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ${insertDoNothingClause(this.contentDb.dialect, 'id')}
      `, [
        entry.id,
        entry.skillId,
        entry.skillVersion,
        entry.proposalId,
        entry.action,
        entry.actor,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after ? JSON.stringify(entry.after) : null,
        entry.createdAt.toISOString()
      ]);
      await this.catalog?.upsertAuditEntry(entry);
    } catch (err) {
      throw new StorageError('Failed to append audit entry in database: ' + (err as Error).message);
    }
  }

  async findBySkillId(skillId: string): Promise<AuditEntry[]> {
    try {
      const rows = await this.contentDb.queryAll<AuditRow>(`
        SELECT * FROM content_audit_entries
        WHERE skill_id = ?
        ORDER BY created_at, id
      `, [skillId]);
      return rows.map(mapAuditRow);
    } catch (err) {
      throw new StorageError('Failed to read skill audit entries from database: ' + (err as Error).message);
    }
  }

  async findByProposalId(proposalId: string): Promise<AuditEntry[]> {
    try {
      const rows = await this.contentDb.queryAll<AuditRow>(`
        SELECT * FROM content_audit_entries
        WHERE proposal_id = ?
        ORDER BY created_at, id
      `, [proposalId]);
      return rows.map(mapAuditRow);
    } catch (err) {
      throw new StorageError('Failed to read proposal audit entries from database: ' + (err as Error).message);
    }
  }

  async findAll(): Promise<AuditEntry[]> {
    try {
      const rows = await this.contentDb.queryAll<AuditRow>(`
        SELECT * FROM content_audit_entries
        ORDER BY created_at, id
      `);
      return rows.map(mapAuditRow);
    } catch (err) {
      throw new StorageError('Failed to read audit entries from database: ' + (err as Error).message);
    }
  }
}

function mapAuditRow(row: AuditRow): AuditEntry {
  return AuditEntry.create({
    id: row.id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    proposalId: row.proposal_id,
    action: row.action,
    actor: row.actor,
    before: row.before_json ? parseJson(row.before_json) as Record<string, unknown> : null,
    after: row.after_json ? parseJson(row.after_json) as Record<string, unknown> : null,
    createdAt: new Date(row.created_at),
  });
}

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}
