#!/usr/bin/env tsx
import { chmod, lstat, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Assignment {
  key: string;
  value: string;
  line: string;
  index: number;
}

interface MigrationPlan {
  configContent: string;
  secretsContent: string;
  movedSecretKeys: string[];
  addedConfigKeys: string[];
}

const SECRET_SUFFIX = /_(?:PASSWORD(?:_HASH)?|SECRET|TOKEN|API_KEY)$/;

function assignments(lines: string[], source: string): Map<string, Assignment> {
  const result = new Map<string, Assignment>();
  lines.forEach((line, index) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return;
    const [, key, value] = match;
    if (result.has(key)) {
      throw new Error(`${source} contains duplicate key ${key}.`);
    }
    result.set(key, { key, value, line, index });
  });
  return result;
}

function normalizedLines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

export function planMigration(config: string, secrets: string, template: string): MigrationPlan {
  const configLines = normalizedLines(config);
  const secretLines = normalizedLines(secrets);
  const templateLines = normalizedLines(template);
  const configAssignments = assignments(configLines, '.env');
  const secretAssignments = assignments(secretLines, '.env.secrets');
  const templateAssignments = assignments(templateLines, '.env.example');
  const movedSecretKeys: string[] = [];
  const addedConfigKeys: string[] = [];
  const removedIndexes = new Set<number>();

  for (const assignment of configAssignments.values()) {
    if (!SECRET_SUFFIX.test(assignment.key)) continue;
    const existing = secretAssignments.get(assignment.key);
    if (existing && existing.value && assignment.value && existing.value !== assignment.value) {
      throw new Error(`Conflicting values exist for secret key ${assignment.key}.`);
    }
    if (existing) {
      if (!existing.value && assignment.value) {
        secretLines[existing.index] = assignment.line;
        secretAssignments.set(assignment.key, { ...assignment, index: existing.index });
      }
    } else {
      secretLines.push(assignment.line);
      secretAssignments.set(assignment.key, { ...assignment, index: secretLines.length - 1 });
    }
    removedIndexes.add(assignment.index);
    movedSecretKeys.push(assignment.key);
  }

  const retainedConfigLines = configLines.filter((_line, index) => !removedIndexes.has(index));
  for (const assignment of templateAssignments.values()) {
    if (SECRET_SUFFIX.test(assignment.key) || configAssignments.has(assignment.key)) continue;
    if (addedConfigKeys.length === 0) {
      retainedConfigLines.push('', '## Added by scripts/content/migrate-env-layout.ts');
    }
    retainedConfigLines.push(assignment.line);
    addedConfigKeys.push(assignment.key);
  }

  return {
    configContent: `${retainedConfigLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`,
    secretsContent: `${secretLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`,
    movedSecretKeys: movedSecretKeys.sort(),
    addedConfigKeys: addedConfigKeys.sort(),
  };
}

async function rejectSymlink(file: string): Promise<void> {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`${path.basename(file)} must not be a symbolic link.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
  await chmod(file, 0o600);
}

async function run(): Promise<void> {
  const write = process.argv.slice(2).includes('--write');
  const unknown = process.argv.slice(2).filter((argument) => argument !== '--write' && argument !== '--check');
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);

  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), '..');
  const configPath = path.join(repoRoot, '.env');
  const secretsPath = path.join(repoRoot, '.env.secrets');
  const templatePath = path.join(repoRoot, '.env.example');
  const secretsTemplatePath = path.join(repoRoot, '.env.secrets.example');
  await rejectSymlink(configPath);
  await rejectSymlink(secretsPath);

  const config = await readFile(configPath, 'utf8');
  let secrets: string;
  try {
    secrets = await readFile(secretsPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    secrets = await readFile(secretsTemplatePath, 'utf8');
  }
  const template = await readFile(templatePath, 'utf8');
  const plan = planMigration(config, secrets, template);
  const changed = plan.configContent !== config || plan.secretsContent !== secrets;

  console.log('env-layout-migration');
  console.log(`movedSecretKeys=${plan.movedSecretKeys.join(',') || 'none'}`);
  console.log(`addedConfigKeys=${plan.addedConfigKeys.join(',') || 'none'}`);
  if (!write) {
    console.log(`RESULT=${changed ? 'CHANGES_REQUIRED' : 'PASS'}`);
    if (changed) process.exitCode = 1;
    return;
  }
  await atomicWrite(configPath, plan.configContent);
  await atomicWrite(secretsPath, plan.secretsContent);
  console.log('RESULT=MIGRATED');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error('env-layout-migration');
    console.error(`RESULT=FAIL error=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
