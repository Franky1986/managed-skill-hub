import Database from 'better-sqlite3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteIdentityPersistence } from './sqlite-identity.persistence';

describe('SqliteIdentityPersistence', () => {
  let directory: string;
  let databasePath: string;
  let persistence: SqliteIdentityPersistence;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-identity-'));
    databasePath = path.join(directory, 'catalog.db');
    persistence = new SqliteIdentityPersistence(databasePath);
  });

  afterEach(async () => {
    persistence.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('projects external subjects idempotently and refreshes mutable profile data', async () => {
    const first = await persistence.upsertExternalPrincipal({
      issuer: 'https://auth.example/application/o/agent/',
      externalSubject: 'user-uuid-1',
      providerClientId: 'managedskillhub-agent-device',
      kind: 'human',
      displayName: 'Initial Name',
      email: 'initial@example.test',
      seenAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const updated = await persistence.upsertExternalPrincipal({
      issuer: 'https://auth.example/application/o/agent/',
      externalSubject: 'user-uuid-1',
      providerClientId: 'managedskillhub-agent-device',
      kind: 'human',
      displayName: 'Changed Name',
      email: 'changed@example.test',
      seenAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    expect(updated.id).toBe(first.id);
    expect(updated.displayName).toBe('Changed Name');
    expect(updated.lastSeenAt.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(await persistence.findByExternalSubject(
      'https://auth.example/application/o/agent/',
      'user-uuid-1'
    )).toMatchObject({ id: first.id });
  });

  it('links another configured issuer only through an explicit principal ID', async () => {
    const agent = await persistence.upsertExternalPrincipal({
      issuer: 'https://auth.example/application/o/agent/',
      externalSubject: 'user-uuid-1',
      providerClientId: 'managedskillhub-agent-device',
      kind: 'human',
      displayName: null,
      email: null,
      seenAt: new Date(),
    });
    const admin = await persistence.upsertExternalPrincipal({
      issuer: 'https://auth.example/application/o/admin/',
      externalSubject: 'user-uuid-1',
      providerClientId: 'managedskillhub-admin-web',
      kind: 'human',
      displayName: null,
      email: null,
      seenAt: new Date(),
      linkToPrincipalId: agent.id,
    });

    expect(admin.id).toBe(agent.id);
  });

  it('atomically converges simultaneous issuer projections on a stable principal ID', async () => {
    const stablePrincipalId = 'f30ff58d-70c7-5b2e-a2f4-5aaad341d845';
    const [agent, admin] = await Promise.all([
      persistence.upsertExternalPrincipal({
        issuer: 'https://auth.example/application/o/agent/',
        externalSubject: 'user-uuid-race',
        providerClientId: 'managedskillhub-agent-device',
        kind: 'human',
        displayName: null,
        email: null,
        seenAt: new Date(),
        stablePrincipalId,
      }),
      persistence.upsertExternalPrincipal({
        issuer: 'https://auth.example/application/o/admin/',
        externalSubject: 'user-uuid-race',
        providerClientId: 'managedskillhub-admin-web',
        kind: 'human',
        displayName: null,
        email: null,
        seenAt: new Date(),
        stablePrincipalId,
      }),
    ]);

    expect(agent.id).toBe(stablePrincipalId);
    expect(admin.id).toBe(stablePrincipalId);
  });

  it('stores only hashed opaque session IDs and enforces expiry and revocation', async () => {
    const principal = await createPrincipal(persistence);
    const now = new Date('2026-01-01T00:00:00.000Z');
    await persistence.create({
      sessionId: 'raw-session-secret',
      principalId: principal.id,
      roles: ['admin'],
      createdAt: now,
      expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    });

    const databaseBytes = await readFile(databasePath);
    expect(databaseBytes.includes(Buffer.from('raw-session-secret'))).toBe(false);
    expect(await persistence.resolve('raw-session-secret', now)).toMatchObject({
      principalId: principal.id,
      roles: ['admin'],
    });
    expect(await persistence.resolve('raw-session-secret', new Date('2026-01-01T02:00:00.000Z'))).toBeNull();

    await persistence.revoke('raw-session-secret', new Date('2026-01-01T00:30:00.000Z'), 'logout');
    expect(await persistence.resolve('raw-session-secret', now)).toBeNull();
  });

  it('consumes login transactions once and never stores raw state', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    await persistence.create({
      state: 'raw-oauth-state',
      nonce: 'nonce-secret',
      pkceVerifier: 'pkce-secret',
      redirectUri: 'https://skills.example/api/admin/auth/oidc/callback',
      returnPath: '/admin/proposals',
      createdAt,
      expiresAt: new Date('2026-01-01T00:10:00.000Z'),
    });

    const databaseBytes = await readFile(databasePath);
    expect(databaseBytes.includes(Buffer.from('raw-oauth-state'))).toBe(false);
    const first = await persistence.consume('raw-oauth-state', new Date('2026-01-01T00:01:00.000Z'));
    const replay = await persistence.consume('raw-oauth-state', new Date('2026-01-01T00:02:00.000Z'));

    expect(first).toMatchObject({ outcome: 'consumed' });
    expect(replay).toEqual({ outcome: 'replayed' });
    expect(await persistence.consume('unknown', createdAt)).toEqual({ outcome: 'missing' });
  });

  it('distinguishes expired state and bounds deterministic cleanup', async () => {
    const principal = await createPrincipal(persistence);
    const now = new Date('2026-01-01T01:00:00.000Z');
    for (let index = 0; index < 3; index += 1) {
      await persistence.create({
        sessionId: `session-${index}`,
        principalId: principal.id,
        roles: ['admin'],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date(`2026-01-01T00:0${index}:00.000Z`),
      });
    }
    await persistence.create({
      state: 'expired-state',
      nonce: 'nonce',
      pkceVerifier: 'verifier',
      redirectUri: 'http://localhost/callback',
      returnPath: '/admin',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-01-01T00:05:00.000Z'),
    });

    expect(await persistence.consume('expired-state', now)).toEqual({ outcome: 'expired' });
    expect(await persistence.cleanupSessions(now, 2)).toBe(2);
    expect(await persistence.cleanupSessions(now, 2)).toBe(1);
    expect(await persistence.cleanupTransactions(now, 1)).toBe(1);

    const db = new Database(databasePath, { readonly: true });
    expect((db.prepare('SELECT COUNT(*) AS count FROM admin_sessions').get() as { count: number }).count).toBe(0);
    db.close();
  });
});

async function createPrincipal(persistence: SqliteIdentityPersistence) {
  return persistence.upsertExternalPrincipal({
    issuer: 'https://auth.example/application/o/admin/',
    externalSubject: 'user-uuid-1',
    providerClientId: 'managedskillhub-admin-web',
    kind: 'human',
    displayName: 'Admin',
    email: null,
    seenAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}
