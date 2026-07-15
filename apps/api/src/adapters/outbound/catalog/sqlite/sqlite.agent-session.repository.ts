import Database from 'better-sqlite3';
import {
  AgentSession,
  AgentSessionArea,
  AgentSessionRepositoryPort,
} from '../../../../application/ports/outbound/agent-session.port';

export class SqliteAgentSessionRepository implements AgentSessionRepositoryPort {
  constructor(private readonly db: Database.Database) {}

  async create(session: AgentSession): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO agent_sessions (
        session_id, code, areas, created_at, expires_at, revoked_at, last_used_at,
        created_by_ip, last_used_ip, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      session.id,
      session.code,
      JSON.stringify(session.areas),
      session.createdAt.toISOString(),
      session.expiresAt.toISOString(),
      session.revokedAt?.toISOString() ?? null,
      session.lastUsedAt?.toISOString() ?? null,
      session.createdByIp,
      session.lastUsedIp,
      session.userAgent
    );
  }

  async findByCode(code: string): Promise<AgentSession | null> {
    const row = this.db
      .prepare('SELECT * FROM agent_sessions WHERE code = ?')
      .get(code) as AgentSessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  async updateLastUsed(code: string, lastUsedAt: Date, lastUsedIp: string | null): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE agent_sessions
      SET last_used_at = ?, last_used_ip = ?
      WHERE code = ?
    `);
    stmt.run(lastUsedAt.toISOString(), lastUsedIp, code);
  }

  async list(options?: {
    includeExpired?: boolean;
    includeRevoked?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<AgentSession[]> {
    const conditions: string[] = [];
    if (!options?.includeExpired) {
      conditions.push('expires_at > datetime(\'now\')');
    }
    if (!options?.includeRevoked) {
      conditions.push('revoked_at IS NULL');
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderLimit = `ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const sql = `SELECT * FROM agent_sessions ${where} ${orderLimit}`;
    const rows = this.db
      .prepare(sql)
      .all(options?.limit ?? 100, options?.offset ?? 0) as AgentSessionRow[];
    return rows.map(mapRow);
  }

  async revoke(sessionId: string, revokedAt: Date): Promise<boolean> {
    const stmt = this.db.prepare(`
      UPDATE agent_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL
    `);
    const result = stmt.run(revokedAt.toISOString(), sessionId);
    return result.changes > 0;
  }

  async countActiveByIp(ip: string): Promise<number> {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS c FROM agent_sessions
        WHERE created_by_ip = ? AND revoked_at IS NULL AND expires_at > datetime('now')
      `)
      .get(ip) as { c: number } | undefined;
    return Number(row?.c ?? 0);
  }
}

interface AgentSessionRow {
  session_id: string;
  code: string;
  areas: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_by_ip: string | null;
  last_used_ip: string | null;
  user_agent: string | null;
}

function mapRow(row: AgentSessionRow): AgentSession {
  return {
    id: row.session_id,
    code: row.code,
    areas: JSON.parse(row.areas) as AgentSessionArea[],
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    createdByIp: row.created_by_ip,
    lastUsedIp: row.last_used_ip,
    userAgent: row.user_agent,
  };
}
