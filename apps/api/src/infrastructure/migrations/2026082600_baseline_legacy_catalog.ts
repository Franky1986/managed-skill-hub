import { CatalogMigration } from './catalog-migration';

/** Frozen transitional baseline for installations that predate migration history. */
export const migration: CatalogMigration = {
  id: '2026082600_baseline_legacy_catalog',
  description: 'Baseline the legacy catalog schema before versioned migrations.',
  async up(context) { await context.bootstrapLegacySchema(); },
};
