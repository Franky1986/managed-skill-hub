import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { AgentSession } from '../../../../application/ports/outbound/agent-session.port';
import { ensureSqliteCatalogSchema } from './sqlite.catalog-schema';
import { SqliteAgentSessionRepository } from './sqlite.agent-session.repository';

describe('SqliteAgentSessionRepository', () => {
  it('persists and revokes sessions by their non-secret ID', async () => {
    const db = new Database(':memory:');
    try {
      ensureSqliteCatalogSchema(db);
      const repository = new SqliteAgentSessionRepository(db);
      const session: AgentSession = {
        id: crypto.randomUUID(),
        code: 'ABCDEFGH',
        areas: ['proposal'],
        createdAt: new Date('2026-07-15T12:00:00.000Z'),
        expiresAt: new Date('2099-07-15T15:00:00.000Z'),
        revokedAt: null,
        lastUsedAt: null,
        createdByIp: '127.0.0.1',
        lastUsedIp: null,
        userAgent: 'test',
      };

      await repository.create(session);

      expect(await repository.findByCode(session.code)).toMatchObject({
        id: session.id,
        code: session.code,
        areas: ['proposal'],
      });
      expect(await repository.revoke(session.id, new Date('2026-07-15T13:00:00.000Z'))).toBe(true);
      expect((await repository.findByCode(session.code))?.revokedAt).toEqual(
        new Date('2026-07-15T13:00:00.000Z')
      );
    } finally {
      db.close();
    }
  });

  it('backfills a stable non-secret ID for legacy session rows', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE agent_sessions (
          code TEXT PRIMARY KEY,
          areas TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          last_used_at TEXT,
          created_by_ip TEXT,
          last_used_ip TEXT,
          user_agent TEXT
        );
        INSERT INTO agent_sessions (
          code, areas, created_at, expires_at, revoked_at, last_used_at,
          created_by_ip, last_used_ip, user_agent
        ) VALUES (
          'LEGACY01', '["proposal"]', '2026-07-15T12:00:00.000Z',
          '2099-07-15T15:00:00.000Z', NULL, NULL, NULL, NULL, NULL
        );
      `);

      ensureSqliteCatalogSchema(db);
      const firstId = (db.prepare(
        'SELECT session_id FROM agent_sessions WHERE code = ?'
      ).get('LEGACY01') as { session_id: string }).session_id;
      ensureSqliteCatalogSchema(db);
      const secondId = (db.prepare(
        'SELECT session_id FROM agent_sessions WHERE code = ?'
      ).get('LEGACY01') as { session_id: string }).session_id;

      expect(firstId).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      expect(secondId).toBe(firstId);
    } finally {
      db.close();
    }
  });
});
