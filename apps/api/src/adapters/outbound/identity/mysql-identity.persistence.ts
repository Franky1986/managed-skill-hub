import crypto from 'node:crypto';
import {
  AdminSessionPort,
  AdminSessionRecord,
  CreateAdminSessionInput,
} from '../../../application/ports/outbound/admin-session.port';
import {
  OidcLoginTransactionPort,
  CreateOidcLoginTransactionInput,
  ConsumeOidcLoginTransactionResult,
} from '../../../application/ports/outbound/oidc-login-transaction.port';
import {
  PrincipalRecord,
  PrincipalRepositoryPort,
  UpsertExternalPrincipalInput,
} from '../../../application/ports/outbound/principal-repository.port';
import { PrincipalKind, PrincipalRole } from '../../../application/security/authenticated-principal';
import { StorageError, ValidationError } from '../../../domain/errors';
import { ensureMysqlCatalogSchema } from '../catalog/mysql/mysql.catalog-schema';
import { MysqlClient, MysqlConnection } from '../mysql/mysql.connection';
import { hashOpaqueCredential } from './opaque-credential-hash';

interface PrincipalRow {
  id: string;
  kind: PrincipalKind;
  display_name: string | null;
  email: string | null;
  first_seen_at: string | Date;
  last_seen_at: string | Date;
  disabled_at: string | Date | null;
}

export class MysqlIdentityPersistence
implements PrincipalRepositoryPort, AdminSessionPort, OidcLoginTransactionPort {
  private readonly schemaReady: Promise<void>;

  constructor(private readonly client: MysqlClient) {
    this.schemaReady = ensureMysqlCatalogSchema(client);
  }

  async findById(principalId: string): Promise<PrincipalRecord | null> {
    await this.schemaReady;
    const rows = await this.client.query<PrincipalRow>(
      'SELECT * FROM identity_principals WHERE id = ?',
      [principalId]
    );
    return rows[0] ? mapPrincipal(rows[0]) : null;
  }

  async findByExternalSubject(issuer: string, externalSubject: string): Promise<PrincipalRecord | null> {
    await this.schemaReady;
    const rows = await this.client.query<PrincipalRow>(`
      SELECT p.*
      FROM identity_external_subjects e
      JOIN identity_principals p ON p.id = e.principal_id
      WHERE e.issuer = ? AND e.external_subject = ?
    `, [issuer, externalSubject]);
    return rows[0] ? mapPrincipal(rows[0]) : null;
  }

  async upsertExternalPrincipal(input: UpsertExternalPrincipalInput): Promise<PrincipalRecord> {
    validateExternalPrincipalInput(input);
    await this.schemaReady;
    try {
      return await this.client.withTransaction(async (connection) => {
        const existingRows = await queryConnection<PrincipalRow>(connection, `
          SELECT p.*
          FROM identity_external_subjects e
          JOIN identity_principals p ON p.id = e.principal_id
          WHERE e.issuer = ? AND e.external_subject = ?
          FOR UPDATE
        `, [input.issuer, input.externalSubject]);
        const existing = existingRows[0];
        const principalId = existing?.id
          ?? input.linkToPrincipalId
          ?? input.stablePrincipalId
          ?? crypto.randomUUID();

        if (!existing && input.linkToPrincipalId) {
          const linked = await queryConnection<{ id: string }>(
            connection,
            'SELECT id FROM identity_principals WHERE id = ? FOR UPDATE',
            [input.linkToPrincipalId]
          );
          if (!linked[0]) {
            throw new ValidationError('The explicitly linked principal does not exist.');
          }
        }

        if (existing || input.linkToPrincipalId) {
          await executeConnection(connection, `
            UPDATE identity_principals
            SET kind = ?, display_name = ?, email = ?, last_seen_at = ?
            WHERE id = ?
          `, [input.kind, input.displayName, input.email, toMysqlDate(input.seenAt), principalId]);
        } else if (input.stablePrincipalId) {
          await executeConnection(connection, `
            INSERT INTO identity_principals (
              id, kind, display_name, email, first_seen_at, last_seen_at, disabled_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL)
            ON DUPLICATE KEY UPDATE
              kind = VALUES(kind),
              display_name = VALUES(display_name),
              email = VALUES(email),
              last_seen_at = VALUES(last_seen_at)
          `, [
            principalId,
            input.kind,
            input.displayName,
            input.email,
            toMysqlDate(input.seenAt),
            toMysqlDate(input.seenAt),
          ]);
        } else {
          await executeConnection(connection, `
            INSERT INTO identity_principals (
              id, kind, display_name, email, first_seen_at, last_seen_at, disabled_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL)
          `, [
            principalId,
            input.kind,
            input.displayName,
            input.email,
            toMysqlDate(input.seenAt),
            toMysqlDate(input.seenAt),
          ]);
        }

        await executeConnection(connection, `
          INSERT INTO identity_external_subjects (
            issuer, external_subject, principal_id, provider_client_id, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            provider_client_id = VALUES(provider_client_id),
            last_seen_at = VALUES(last_seen_at)
        `, [
          input.issuer,
          input.externalSubject,
          principalId,
          input.providerClientId,
          toMysqlDate(input.seenAt),
          toMysqlDate(input.seenAt),
        ]);
        const result = await queryConnection<PrincipalRow>(
          connection,
          'SELECT * FROM identity_principals WHERE id = ?',
          [principalId]
        );
        return mapPrincipal(result[0]);
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(`Failed to project external principal: ${(error as Error).message}`);
    }
  }

  async create(input: CreateAdminSessionInput | CreateOidcLoginTransactionInput): Promise<void> {
    await this.schemaReady;
    if ('sessionId' in input) {
      await this.client.execute(`
        INSERT INTO admin_sessions (
          session_id_hash, principal_id, roles_json, created_at, last_seen_at, expires_at,
          revoked_at, revoked_reason
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
      `, [
        hashOpaqueCredential(input.sessionId),
        input.principalId,
        JSON.stringify(input.roles),
        toMysqlDate(input.createdAt),
        toMysqlDate(input.createdAt),
        toMysqlDate(input.expiresAt),
      ]);
      return;
    }
    await this.client.execute(`
      INSERT INTO oidc_login_transactions (
        state_hash, nonce, pkce_verifier, redirect_uri, return_path, created_at, expires_at, consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `, [
      hashOpaqueCredential(input.state),
      input.nonce,
      input.pkceVerifier,
      input.redirectUri,
      input.returnPath,
      toMysqlDate(input.createdAt),
      toMysqlDate(input.expiresAt),
    ]);
  }

  async resolve(sessionId: string, now: Date): Promise<AdminSessionRecord | null> {
    await this.schemaReady;
    const rows = await this.client.query<{
      principal_id: string;
      roles_json: string | PrincipalRole[];
      created_at: string | Date;
      last_seen_at: string | Date;
      expires_at: string | Date;
      revoked_at: string | Date | null;
      revoked_reason: string | null;
    }>(`
      SELECT principal_id, roles_json, created_at, last_seen_at, expires_at, revoked_at, revoked_reason
      FROM admin_sessions
      WHERE session_id_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `, [hashOpaqueCredential(sessionId), toMysqlDate(now)]);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      principalId: row.principal_id,
      roles: parseRoles(row.roles_json),
      createdAt: parseMysqlDate(row.created_at),
      lastSeenAt: parseMysqlDate(row.last_seen_at),
      expiresAt: parseMysqlDate(row.expires_at),
      revokedAt: row.revoked_at ? parseMysqlDate(row.revoked_at) : null,
      revokedReason: row.revoked_reason,
    };
  }

  async touch(sessionId: string, seenAt: Date): Promise<void> {
    await this.schemaReady;
    await this.client.execute(`
      UPDATE admin_sessions SET last_seen_at = ?
      WHERE session_id_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `, [toMysqlDate(seenAt), hashOpaqueCredential(sessionId), toMysqlDate(seenAt)]);
  }

  async revoke(sessionId: string, revokedAt: Date, reason: string): Promise<void> {
    await this.schemaReady;
    await this.client.execute(`
      UPDATE admin_sessions SET revoked_at = ?, revoked_reason = ?
      WHERE session_id_hash = ? AND revoked_at IS NULL
    `, [toMysqlDate(revokedAt), reason, hashOpaqueCredential(sessionId)]);
  }

  async consume(state: string, now: Date): Promise<ConsumeOidcLoginTransactionResult> {
    await this.schemaReady;
    return this.client.withTransaction(async (connection) => {
      const rows = await queryConnection<{
        nonce: string;
        pkce_verifier: string;
        redirect_uri: string;
        return_path: string;
        created_at: string | Date;
        expires_at: string | Date;
        consumed_at: string | Date | null;
      }>(connection, `
        SELECT nonce, pkce_verifier, redirect_uri, return_path, created_at, expires_at, consumed_at
        FROM oidc_login_transactions WHERE state_hash = ? FOR UPDATE
      `, [hashOpaqueCredential(state)]);
      const row = rows[0];
      if (!row) {
        return { outcome: 'missing' };
      }
      if (row.consumed_at) {
        return { outcome: 'replayed' };
      }
      if (parseMysqlDate(row.expires_at).getTime() <= now.getTime()) {
        return { outcome: 'expired' };
      }
      await executeConnection(connection, `
        UPDATE oidc_login_transactions SET consumed_at = ?
        WHERE state_hash = ? AND consumed_at IS NULL
      `, [toMysqlDate(now), hashOpaqueCredential(state)]);
      return {
        outcome: 'consumed',
        transaction: {
          nonce: row.nonce,
          pkceVerifier: row.pkce_verifier,
          redirectUri: row.redirect_uri,
          returnPath: row.return_path,
          createdAt: parseMysqlDate(row.created_at),
          expiresAt: parseMysqlDate(row.expires_at),
        },
      };
    });
  }

  async cleanupSessions(now: Date, limit: number): Promise<number> {
    validateCleanupLimit(limit);
    await this.schemaReady;
    const rows = await this.client.query<{ session_id_hash: string }>(`
      SELECT session_id_hash FROM admin_sessions
      WHERE expires_at <= ? OR revoked_at IS NOT NULL
      ORDER BY expires_at, session_id_hash LIMIT ?
    `, [toMysqlDate(now), limit]);
    if (rows.length === 0) {
      return 0;
    }
    await this.client.execute(
      `DELETE FROM admin_sessions WHERE session_id_hash IN (${placeholders(rows.length)})`,
      rows.map((row) => row.session_id_hash)
    );
    return rows.length;
  }

  async cleanupTransactions(now: Date, limit: number): Promise<number> {
    validateCleanupLimit(limit);
    await this.schemaReady;
    const rows = await this.client.query<{ state_hash: string }>(`
      SELECT state_hash FROM oidc_login_transactions
      WHERE expires_at <= ? OR consumed_at IS NOT NULL
      ORDER BY expires_at, state_hash LIMIT ?
    `, [toMysqlDate(now), limit]);
    if (rows.length === 0) {
      return 0;
    }
    await this.client.execute(
      `DELETE FROM oidc_login_transactions WHERE state_hash IN (${placeholders(rows.length)})`,
      rows.map((row) => row.state_hash)
    );
    return rows.length;
  }
}

async function queryConnection<T>(
  connection: MysqlConnection,
  sql: string,
  params: unknown[]
): Promise<T[]> {
  const [rows] = await connection.execute<T>(sql, params);
  return rows;
}

async function executeConnection(
  connection: MysqlConnection,
  sql: string,
  params: unknown[]
): Promise<void> {
  await connection.execute(sql, params);
}

function mapPrincipal(row: PrincipalRow): PrincipalRecord {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    email: row.email,
    firstSeenAt: parseMysqlDate(row.first_seen_at),
    lastSeenAt: parseMysqlDate(row.last_seen_at),
    disabledAt: row.disabled_at ? parseMysqlDate(row.disabled_at) : null,
  };
}

function parseRoles(value: string | PrincipalRole[]): PrincipalRole[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || !parsed.every(isPrincipalRole)) {
    throw new StorageError('Stored administrator session roles are invalid.');
  }
  return parsed;
}

function isPrincipalRole(value: unknown): value is PrincipalRole {
  return value === 'submitter' || value === 'reader' || value === 'reviewer'
    || value === 'publisher' || value === 'admin';
}

function toMysqlDate(value: Date): string {
  return value.toISOString().slice(0, 23).replace('T', ' ');
}

function parseMysqlDate(value: string | Date): Date {
  if (value instanceof Date) {
    return value;
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const result = new Date(normalized);
  if (Number.isNaN(result.getTime())) {
    throw new StorageError('Stored MySQL identity timestamp is invalid.');
  }
  return result;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function validateExternalPrincipalInput(input: UpsertExternalPrincipalInput): void {
  if (!input.issuer || !input.externalSubject || !input.providerClientId) {
    throw new ValidationError('Issuer, external subject, and provider client ID are required.');
  }
  if (Buffer.byteLength(input.issuer, 'utf8') > 1024 || input.externalSubject.length > 255) {
    throw new ValidationError('Issuer or external subject exceeds the relational identity limits.');
  }
}

function validateCleanupLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 10_000) {
    throw new ValidationError('Cleanup limit must be an integer between 1 and 10000.');
  }
}
