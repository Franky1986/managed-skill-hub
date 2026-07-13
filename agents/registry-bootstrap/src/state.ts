import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SyncState } from './types.js';

export interface StateManagerOptions {
  stateFile: string;
  outputDir: string;
}

export class StateManager {
  private readonly stateFile: string;
  readonly outputDir: string;

  constructor(options: StateManagerOptions) {
    this.stateFile = resolve(options.stateFile);
    this.outputDir = resolve(options.outputDir);
  }

  async load(): Promise<SyncState> {
    if (!existsSync(this.stateFile)) {
      return {
        registryUrl: '',
        lastSyncedAt: new Date(0).toISOString(),
        skills: {},
      };
    }

    const raw = await readFile(this.stateFile, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      registryUrl: parsed.registryUrl ?? '',
      lastSyncedAt: parsed.lastSyncedAt ?? new Date(0).toISOString(),
      skills: parsed.skills ?? {},
    };
  }

  async save(state: SyncState): Promise<void> {
    await mkdir(dirname(this.stateFile), { recursive: true });
    await writeFile(this.stateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  skillDir(skillId: string): string {
    return resolve(this.outputDir, skillId);
  }

  filePath(skillId: string, filePath: string): string {
    // Normalize registry-relative paths to local output paths while preventing traversal.
    const relative = filePath.replace(/^\//, '');
    if (relative.includes('..')) {
      throw new Error(`Unsafe file path: ${filePath}`);
    }
    return resolve(this.outputDir, skillId, relative);
  }
}
