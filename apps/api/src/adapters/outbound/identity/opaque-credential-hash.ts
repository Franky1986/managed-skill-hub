import crypto from 'node:crypto';

export function hashOpaqueCredential(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
