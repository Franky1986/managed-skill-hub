import { PrincipalRole } from '../../security/authenticated-principal';

export interface AdminSessionRecord {
  principalId: string;
  roles: PrincipalRole[];
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface CreateAdminSessionInput {
  sessionId: string;
  principalId: string;
  roles: PrincipalRole[];
  createdAt: Date;
  expiresAt: Date;
}

export interface AdminSessionPort {
  create(input: CreateAdminSessionInput): Promise<void>;
  resolve(sessionId: string, now: Date): Promise<AdminSessionRecord | null>;
  touch(sessionId: string, seenAt: Date): Promise<void>;
  revoke(sessionId: string, revokedAt: Date, reason: string): Promise<void>;
  cleanupSessions(now: Date, limit: number): Promise<number>;
}
