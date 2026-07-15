import {
  AgentSession,
  AgentSessionArea,
  AgentSessionRepositoryPort,
} from '../../../../application/ports/outbound/agent-session.port';
import { MysqlClient } from '../../mysql/mysql.connection';

export class MysqlAgentSessionRepository implements AgentSessionRepositoryPort {
  constructor(private readonly client: MysqlClient) {}

  async create(session: AgentSession): Promise<void> {
    await this.client.execute(`
      INSERT INTO agent_sessions (
        session_id, code, areas, created_at, expires_at, revoked_at, last_used_at,
        created_by_ip, last_used_ip, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      session.id,
      session.code,
      JSON.stringify(session.areas),
      toMysqlDate(session.createdAt),
      toMysqlDate(session.expiresAt),
      session.revokedAt ? toMysqlDate(session.revokedAt) : null,
      session.lastUsedAt ? toMysqlDate(session.lastUsedAt) : null,
      session.createdByIp,
      session.lastUsedIp,
      session.userAgent,
    ]);
  }

  async findByCode(code: string): Promise<AgentSession | null> {
    const rows = await this.client.query<AgentSessionRow>(
      'SELECT * FROM agent_sessions WHERE code = ?',
      [code]
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  }

  async updateLastUsed(code: string, lastUsedAt: Date, lastUsedIp: string | null): Promise<void> {
    await this.client.execute(`
      UPDATE agent_sessions
      SET last_used_at = ?, last_used_ip = ?
      WHERE code = ?
    `, [toMysqlDate(lastUsedAt), lastUsedIp, code]);
  }

  async list(options?: {
    includeExpired?: boolean;
    includeRevoked?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<AgentSession[]> {
    const conditions: string[] = [];
    if (!options?.includeExpired) {
      conditions.push('expires_at > UTC_TIMESTAMP()');
    }
    if (!options?.includeRevoked) {
      conditions.push('revoked_at IS NULL');
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM agent_sessions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const rows = await this.client.query<AgentSessionRow>(sql, [
      options?.limit ?? 100,
      options?.offset ?? 0,
    ]);
    return rows.map(mapRow);
  }

  async revoke(sessionId: string, revokedAt: Date): Promise<boolean> {
    const existingRows = await this.client.query<AgentSessionRow>(
      'SELECT * FROM agent_sessions WHERE session_id = ?',
      [sessionId]
    );
    if (!existingRows[0] || existingRows[0].revoked_at !== null) {
      return false;
    }
    await this.client.execute(`
      UPDATE agent_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL
    `, [toMysqlDate(revokedAt), sessionId]);
    return true;
  }

  async countActiveByIp(ip: string): Promise<number> {
    const rows = await this.client.query<{ c: number | string }>(`
      SELECT COUNT(*) AS c FROM agent_sessions
      WHERE created_by_ip = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()
    `, [ip]);
    return Number(rows[0]?.c ?? 0);
  }
}

interface AgentSessionRow {
  session_id: string;
  code: string;
  areas: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
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

function toMysqlDate(date: Date): string {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}
