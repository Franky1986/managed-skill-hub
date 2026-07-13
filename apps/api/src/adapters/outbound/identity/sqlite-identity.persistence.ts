import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
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
import { ensureSqliteCatalogSchema } from '../catalog/sqlite/sqlite.catalog-schema';
import { hashOpaqueCredential } from './opaque-credential-hash';

interface PrincipalRow {
  id: string;
  kind: PrincipalKind;
  display_name: string | null;
  email: string | null;
  first_seen_at: string;
  last_seen_at: string;
  disabled_at: string | null;
}

export class SqliteIdentityPersistence
implements PrincipalRepositoryPort, AdminSessionPort, OidcLoginTransactionPort {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    ensureSqliteCatalogSchema(this.db);
  }

  async findById(principalId: string): Promise<PrincipalRecord | null> {
    const row = this.db.prepare('SELECT * FROM identity_principals WHERE id = ?').get(principalId) as
      PrincipalRow | undefined;
    return row ? mapPrincipal(row) : null;
  }

  async findByExternalSubject(issuer: string, externalSubject: string): Promise<PrincipalRecord | null> {
    const row = this.db.prepare(`
      SELECT p.*
      FROM identity_external_subjects e
      JOIN identity_principals p ON p.id = e.principal_id
      WHERE e.issuer = ? AND e.external_subject = ?
    `).get(issuer, externalSubject) as PrincipalRow | undefined;
    return row ? mapPrincipal(row) : null;
  }

  async upsertExternalPrincipal(input: UpsertExternalPrincipalInput): Promise<PrincipalRecord> {
    validateExternalPrincipalInput(input);
    try {
      return this.db.transaction(() => {
        const existing = this.db.prepare(`
          SELECT p.*
          FROM identity_external_subjects e
          JOIN identity_principals p ON p.id = e.principal_id
          WHERE e.issuer = ? AND e.external_subject = ?
        `).get(input.issuer, input.externalSubject) as PrincipalRow | undefined;
        const principalId = existing?.id
          ?? input.linkToPrincipalId
          ?? input.stablePrincipalId
          ?? crypto.randomUUID();

        if (!existing && input.linkToPrincipalId) {
          const linked = this.db.prepare('SELECT id FROM identity_principals WHERE id = ?')
            .get(input.linkToPrincipalId);
          if (!linked) {
            throw new ValidationError('The explicitly linked principal does not exist.');
          }
        }

        if (existing || input.linkToPrincipalId) {
          this.db.prepare(`
            UPDATE identity_principals
            SET kind = ?, display_name = ?, email = ?, last_seen_at = ?
            WHERE id = ?
          `).run(input.kind, input.displayName, input.email, input.seenAt.toISOString(), principalId);
        } else if (input.stablePrincipalId) {
          this.db.prepare(`
            INSERT INTO identity_principals (
              id, kind, display_name, email, first_seen_at, last_seen_at, disabled_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              kind = excluded.kind,
              display_name = excluded.display_name,
              email = excluded.email,
              last_seen_at = excluded.last_seen_at
          `).run(
            principalId,
            input.kind,
            input.displayName,
            input.email,
            input.seenAt.toISOString(),
            input.seenAt.toISOString()
          );
        } else {
          this.db.prepare(`
            INSERT INTO identity_principals (
              id, kind, display_name, email, first_seen_at, last_seen_at, disabled_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL)
          `).run(
            principalId,
            input.kind,
            input.displayName,
            input.email,
            input.seenAt.toISOString(),
            input.seenAt.toISOString()
          );
        }

        this.db.prepare(`
          INSERT INTO identity_external_subjects (
            issuer, external_subject, principal_id, provider_client_id, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(issuer, external_subject) DO UPDATE SET
            provider_client_id = excluded.provider_client_id,
            last_seen_at = excluded.last_seen_at
        `).run(
          input.issuer,
          input.externalSubject,
          principalId,
          input.providerClientId,
          input.seenAt.toISOString(),
          input.seenAt.toISOString()
        );

        return mapPrincipal(this.db.prepare('SELECT * FROM identity_principals WHERE id = ?')
          .get(principalId) as PrincipalRow);
      })();
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new StorageError(`Failed to project external principal: ${(error as Error).message}`);
    }
  }

  async create(input: CreateAdminSessionInput | CreateOidcLoginTransactionInput): Promise<void> {
    if ('sessionId' in input) {
      this.createSession(input);
      return;
    }
    this.createLoginTransaction(input);
  }

  async resolve(sessionId: string, now: Date): Promise<AdminSessionRecord | null> {
    const row = this.db.prepare(`
      SELECT principal_id, roles_json, created_at, last_seen_at, expires_at, revoked_at, revoked_reason
      FROM admin_sessions
      WHERE session_id_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(hashOpaqueCredential(sessionId), now.toISOString()) as {
      principal_id: string;
      roles_json: string;
      created_at: string;
      last_seen_at: string;
      expires_at: string;
      revoked_at: string | null;
      revoked_reason: string | null;
    } | undefined;
    if (!row) {
      return null;
    }
    return {
      principalId: row.principal_id,
      roles: parseRoles(row.roles_json),
      createdAt: new Date(row.created_at),
      lastSeenAt: new Date(row.last_seen_at),
      expiresAt: new Date(row.expires_at),
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      revokedReason: row.revoked_reason,
    };
  }

  async touch(sessionId: string, seenAt: Date): Promise<void> {
    this.db.prepare(`
      UPDATE admin_sessions SET last_seen_at = ?
      WHERE session_id_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `).run(seenAt.toISOString(), hashOpaqueCredential(sessionId), seenAt.toISOString());
  }

  async revoke(sessionId: string, revokedAt: Date, reason: string): Promise<void> {
    this.db.prepare(`
      UPDATE admin_sessions SET revoked_at = ?, revoked_reason = ?
      WHERE session_id_hash = ? AND revoked_at IS NULL
    `).run(revokedAt.toISOString(), reason, hashOpaqueCredential(sessionId));
  }

  async consume(state: string, now: Date): Promise<ConsumeOidcLoginTransactionResult> {
    const stateHash = hashOpaqueCredential(state);
    return this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT nonce, pkce_verifier, redirect_uri, return_path, created_at, expires_at, consumed_at
        FROM oidc_login_transactions WHERE state_hash = ?
      `).get(stateHash) as {
        nonce: string;
        pkce_verifier: string;
        redirect_uri: string;
        return_path: string;
        created_at: string;
        expires_at: string;
        consumed_at: string | null;
      } | undefined;
      if (!row) {
        return { outcome: 'missing' } as const;
      }
      if (row.consumed_at) {
        return { outcome: 'replayed' } as const;
      }
      if (new Date(row.expires_at).getTime() <= now.getTime()) {
        return { outcome: 'expired' } as const;
      }
      const update = this.db.prepare(`
        UPDATE oidc_login_transactions SET consumed_at = ?
        WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?
      `).run(now.toISOString(), stateHash, now.toISOString());
      if (update.changes !== 1) {
        return { outcome: 'replayed' } as const;
      }
      return {
        outcome: 'consumed',
        transaction: {
          nonce: row.nonce,
          pkceVerifier: row.pkce_verifier,
          redirectUri: row.redirect_uri,
          returnPath: row.return_path,
          createdAt: new Date(row.created_at),
          expiresAt: new Date(row.expires_at),
        },
      } as const;
    })();
  }

  async cleanupSessions(now: Date, limit: number): Promise<number> {
    validateCleanupLimit(limit);
    const nowIso = now.toISOString();
    const deleteSessions = this.db.prepare(`
      DELETE FROM admin_sessions WHERE session_id_hash IN (
        SELECT session_id_hash FROM admin_sessions
        WHERE expires_at <= ? OR revoked_at IS NOT NULL
        ORDER BY expires_at, session_id_hash LIMIT ?
      )
    `).run(nowIso, limit);
    return deleteSessions.changes;
  }

  async cleanupTransactions(now: Date, limit: number): Promise<number> {
    validateCleanupLimit(limit);
    const deleteTransactions = this.db.prepare(`
      DELETE FROM oidc_login_transactions WHERE state_hash IN (
        SELECT state_hash FROM oidc_login_transactions
        WHERE expires_at <= ? OR consumed_at IS NOT NULL
        ORDER BY expires_at, state_hash LIMIT ?
      )
    `).run(now.toISOString(), limit);
    return deleteTransactions.changes;
  }

  close(): void {
    this.db.close();
  }

  private createSession(input: CreateAdminSessionInput): void {
    this.db.prepare(`
      INSERT INTO admin_sessions (
        session_id_hash, principal_id, roles_json, created_at, last_seen_at, expires_at,
        revoked_at, revoked_reason
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      hashOpaqueCredential(input.sessionId),
      input.principalId,
      JSON.stringify(input.roles),
      input.createdAt.toISOString(),
      input.createdAt.toISOString(),
      input.expiresAt.toISOString()
    );
  }

  private createLoginTransaction(input: CreateOidcLoginTransactionInput): void {
    this.db.prepare(`
      INSERT INTO oidc_login_transactions (
        state_hash, nonce, pkce_verifier, redirect_uri, return_path, created_at, expires_at, consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      hashOpaqueCredential(input.state),
      input.nonce,
      input.pkceVerifier,
      input.redirectUri,
      input.returnPath,
      input.createdAt.toISOString(),
      input.expiresAt.toISOString()
    );
  }
}

function mapPrincipal(row: PrincipalRow): PrincipalRecord {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    email: row.email,
    firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
    disabledAt: row.disabled_at ? new Date(row.disabled_at) : null,
  };
}

function parseRoles(value: string): PrincipalRole[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(isPrincipalRole)) {
    throw new StorageError('Stored administrator session roles are invalid.');
  }
  return parsed;
}

function isPrincipalRole(value: unknown): value is PrincipalRole {
  return value === 'submitter' || value === 'reader' || value === 'reviewer'
    || value === 'publisher' || value === 'admin';
}

function validateExternalPrincipalInput(input: UpsertExternalPrincipalInput): void {
  if (!input.issuer || !input.externalSubject || !input.providerClientId) {
    throw new ValidationError('Issuer, external subject, and provider client ID are required.');
  }
}

function validateCleanupLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 10_000) {
    throw new ValidationError('Cleanup limit must be an integer between 1 and 10000.');
  }
}
