import { resolve } from 'node:path';
import { RegistryClient } from './client.js';
import { StateManager } from './state.js';
import { pullSkill, syncAll } from './commands.js';

const args = process.argv.slice(2);
const command = args[0];

function showUsage(): void {
  console.log(`
managed-skill-hub registry bootstrap

Usage:
  npx tsx src/index.ts <command> [options]

Commands:
  discover                          Show registry discovery info and categories
  list [category]                   List published skills
  search <query> [mode]            Search published skills (keyword|fulltext|regex)
  pull <skillId> [--version=...]   Pull a specific skill into the local cache
  sync [--category=...]             Sync all published skills, downloading only changed artifacts

Environment:
  REGISTRY_URL                      Base URL of managed-skill-hub (default: http://localhost:3040)
  REGISTRY_OUTPUT_DIR               Local directory to store pulled skills (default: ./.skill-cache)
  REGISTRY_STATE_FILE               Path to sync state JSON (default: ./.skill-cache/.state.json)

Examples:
  REGISTRY_URL=http://localhost:3040 npx tsx src/index.ts discover
  npx tsx src/index.ts list
  npx tsx src/index.ts search onboarding
  npx tsx src/index.ts pull how-to-create-a-skill
  npx tsx src/index.ts sync --category=onboarding
`);
}

function env(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

async function main(): Promise<void> {
  const baseUrl = env('REGISTRY_URL', 'http://localhost:3040');
  const outputDir = env('REGISTRY_OUTPUT_DIR', './.skill-cache');
  const stateFile = env('REGISTRY_STATE_FILE', resolve(outputDir, '.state.json'));

  const client = new RegistryClient({ baseUrl });
  const state = new StateManager({ stateFile, outputDir });

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      showUsage();
      return;

    case 'discover': {
      const discovery = await client.discover();
      const categories = await client.listCategories();
      console.log('Registry:', discovery.name, discovery.version);
      console.log('Read auth required:', discovery.readAuthRequired);
      console.log('Entrypoints:', discovery.entrypoints.join(', '));
      console.log('Categories:', categories.items.join(', ') || '(none)');
      return;
    }

    case 'list': {
      const category = args[1];
      const list = await client.listSkills(category, 1000, 0);
      console.log(`Found ${list.total} published skills${category ? ` in category "${category}"` : ''}`);
      for (const skill of list.items) {
        console.log(
          `  ${skill.id.padEnd(40)} ${skill.version.padEnd(12)} ${skill.skillUuid} ${skill.contentDigest.slice(0, 16)}`
        );
      }
      return;
    }

    case 'search': {
      const query = args[1];
      const mode = (args[2] as 'keyword' | 'fulltext' | 'regex') ?? 'keyword';
      if (!query) {
        console.error('Missing search query');
        process.exitCode = 1;
        return;
      }
      const results = await client.searchSkills(query, mode);
      console.log(`Found ${results.total} results for "${query}" (${mode})`);
      for (const skill of results.items) {
        const score = 'score' in skill ? (skill as { score?: number }).score : undefined;
        console.log(
          `  ${skill.id.padEnd(40)} ${skill.title}${score !== undefined ? ` (score ${score.toFixed(2)})` : ''}`
        );
      }
      return;
    }

    case 'pull': {
      const skillId = args[1];
      const version = parseFlag('version');
      const dryRun = hasFlag('dry-run');
      if (!skillId) {
        console.error('Missing skillId');
        process.exitCode = 1;
        return;
      }
      const result = await pullSkill({ client, state, skillId, version, dryRun });
      console.log(
        `${dryRun ? 'Would pull' : 'Pulled'} ${result.files} file(s) for ${result.skillId}@${result.version} to ${result.writtenTo}`
      );
      return;
    }

    case 'sync': {
      const category = parseFlag('category');
      const dryRun = hasFlag('dry-run');
      const purgeOrphans = hasFlag('purge-orphans');
      const result = await syncAll({ client, state, category, dryRun, purgeOrphans });
      console.log(
        `${dryRun ? 'Would sync' : 'Synced'} ${result.pulled.length} skill(s), skipped ${result.skipped.length}`
      );
      if (result.updatedFiles > 0) console.log(`  updated files: ${result.updatedFiles}`);
      if (result.removedFiles > 0) console.log(`  removed files: ${result.removedFiles}`);
      if (result.errors.length > 0) {
        console.error('Errors:');
        for (const err of result.errors) {
          console.error(`  ${err.skillId}: ${err.message}`);
        }
        process.exitCode = 2;
      }
      return;
    }

    default:
      console.error(`Unknown command: ${command}`);
      showUsage();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
