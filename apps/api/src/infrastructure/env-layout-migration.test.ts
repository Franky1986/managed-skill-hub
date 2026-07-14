import { describe, expect, it } from 'vitest';
import { planMigration } from '../../../../scripts/migrate-env-layout';

describe('environment layout migration', () => {
  it('moves secrets without exposing them in config and appends missing config keys', () => {
    const plan = planMigration(
      'NODE_ENV=development\nJWT_SECRET=private-value\n',
      'JWT_SECRET=\nOIDC_ADMIN_CLIENT_SECRET=\n',
      'NODE_ENV=development\nADMIN_AUTH_MODE=simple\n'
    );

    expect(plan.configContent).not.toContain('private-value');
    expect(plan.configContent).toContain('ADMIN_AUTH_MODE=simple');
    expect(plan.secretsContent).toContain('JWT_SECRET=private-value');
    expect(plan.movedSecretKeys).toEqual(['JWT_SECRET']);
    expect(plan.addedConfigKeys).toEqual(['ADMIN_AUTH_MODE']);
  });

  it('preserves an existing non-empty secret when config contains an empty placeholder', () => {
    const plan = planMigration(
      'NODE_ENV=development\nOIDC_ADMIN_CLIENT_SECRET=\n',
      'OIDC_ADMIN_CLIENT_SECRET=existing-secret\n',
      'NODE_ENV=development\n'
    );

    expect(plan.secretsContent).toContain('OIDC_ADMIN_CLIENT_SECRET=existing-secret');
    expect(plan.configContent).not.toContain('OIDC_ADMIN_CLIENT_SECRET');
  });

  it('fails closed when both files contain different non-empty values', () => {
    expect(() => planMigration(
      'JWT_SECRET=one-secret\n',
      'JWT_SECRET=another-secret\n',
      'NODE_ENV=development\n'
    )).toThrow('Conflicting values exist for secret key JWT_SECRET.');
  });
});
