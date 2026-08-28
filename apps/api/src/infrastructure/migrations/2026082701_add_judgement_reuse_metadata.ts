import { CatalogMigration } from './catalog-migration';

export const migration: CatalogMigration = {
  id: '2026082701_add_judgement_reuse_metadata',
  description: 'Add reusable judgement input fingerprint and prompt version metadata.',
  async up(context) {
    await context.addColumnIfMissing('skill_catalog_judgements', 'input_fingerprint', context.provider === 'mysql' ? 'CHAR(64) NULL AFTER model' : 'TEXT');
    await context.addColumnIfMissing('skill_catalog_judgements', 'prompt_version', context.provider === 'mysql' ? 'VARCHAR(255) NULL AFTER input_fingerprint' : 'TEXT');
  },
};
