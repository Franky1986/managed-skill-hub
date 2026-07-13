import { mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { RegistryClient, fileIdFromInfo } from './client.js';
import { StateManager } from './state.js';
import {
  SkillFileInfo,
  SkillResponse,
  SkillSummary,
  SyncedFile,
  SyncedSkill,
  SyncState,
} from './types.js';

export interface SyncOptions {
  client: RegistryClient;
  state: StateManager;
  category?: string;
  dryRun?: boolean;
  purgeOrphans?: boolean;
}

export interface SyncResult {
  pulled: string[];
  skipped: string[];
  updatedFiles: number;
  removedFiles: number;
  errors: Array<{ skillId: string; message: string }>;
}

export async function syncAll(options: SyncOptions): Promise<SyncResult> {
  const { client, state, category, dryRun, purgeOrphans } = options;
  const result: SyncResult = { pulled: [], skipped: [], updatedFiles: 0, removedFiles: 0, errors: [] };

  const remoteList = await client.listSkills(category, 1000, 0);
  const localState = await state.load();
  const nextState: SyncState = {
    registryUrl: client.baseUrl,
    lastSyncedAt: new Date().toISOString(),
    skills: {},
  };

  for (const summary of remoteList.items) {
    try {
      const skillResult = await syncSkill(summary, {
        client,
        state,
        localState,
        dryRun,
        purgeOrphans,
      });
      nextState.skills[summary.id] = skillResult.synced;
      if (skillResult.changed) result.pulled.push(summary.id);
      else result.skipped.push(summary.id);
      result.updatedFiles += skillResult.updatedFiles;
      result.removedFiles += skillResult.removedFiles;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ skillId: summary.id, message });
      // Preserve previous state on error so the next run does not re-pull unchanged files.
      nextState.skills[summary.id] = localState.skills[summary.id];
    }
  }

  if (!dryRun) {
    await state.save(nextState);
  }

  return result;
}

interface SkillSyncResult {
  synced: SyncedSkill;
  changed: boolean;
  updatedFiles: number;
  removedFiles: number;
}

interface SkillSyncContext {
  client: RegistryClient;
  state: StateManager;
  localState: SyncState;
  dryRun?: boolean;
  purgeOrphans?: boolean;
}

async function syncSkill(summary: SkillSummary, ctx: SkillSyncContext): Promise<SkillSyncResult> {
  const { client, state, localState, dryRun, purgeOrphans } = ctx;
  const previous = localState.skills[summary.id];

  // Skill-level sync decision: pull only if skill or version identity/digest changed.
  const skillChanged =
    !previous ||
    previous.skillUuid !== summary.skillUuid ||
    previous.versionUuid !== summary.versionUuid ||
    previous.contentDigest !== summary.contentDigest;

  const detail = skillChanged ? await client.getSkill(summary.id) : undefined;
  const version = detail?.latestPublishedVersion ?? summary.version;

  const fileList = await client.listSkillFiles(summary.id, version);
  const remoteFiles = new Map(fileList.items.map((f) => [f.artifactId, f]));

  const nextFiles: Record<string, SyncedFile> = {};
  let updatedFiles = 0;

  for (const file of fileList.items) {
    const previousFile = previous?.files[file.artifactId];
    const fileChanged =
      skillChanged ||
      !previousFile ||
      previousFile.sha256 !== file.sha256 ||
      previousFile.path !== file.path;

    if (fileChanged) {
      if (!dryRun) {
        await downloadAndWrite(client, state, summary.id, file, version);
      }
      updatedFiles++;
    }

    nextFiles[file.artifactId] = toSyncedFile(file);
  }

  // Purge local files that are no longer referenced by the registry.
  let removedFiles = 0;
  if (purgeOrphans && previous) {
    for (const artifactId of Object.keys(previous.files)) {
      if (!remoteFiles.has(artifactId)) {
        if (!dryRun) {
          const oldPath = state.filePath(summary.id, previous.files[artifactId].path);
          await rm(oldPath, { force: true });
        }
        removedFiles++;
      }
    }
  }

  const synced: SyncedSkill = {
    skillUuid: summary.skillUuid,
    versionUuid: summary.versionUuid,
    contentDigest: summary.contentDigest,
    version,
    title: summary.title,
    category: summary.category,
    entrypoint: detail?.entrypoint ?? summary.id,
    pulledAt: new Date().toISOString(),
    files: nextFiles,
  };

  return {
    synced,
    changed: skillChanged || updatedFiles > 0 || removedFiles > 0,
    updatedFiles,
    removedFiles,
  };
}

async function downloadAndWrite(
  client: RegistryClient,
  state: StateManager,
  skillId: string,
  file: SkillFileInfo,
  version?: string
): Promise<void> {
  const fileId = fileIdFromInfo(file);
  const bytes = await client.downloadFile(skillId, fileId, version);
  const targetPath = state.filePath(skillId, file.path);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, bytes);
}

function toSyncedFile(file: SkillFileInfo): SyncedFile {
  return {
    artifactId: file.artifactId,
    path: file.path,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    updatedAt: file.updatedAt,
  };
}

export interface PullOptions {
  client: RegistryClient;
  state: StateManager;
  skillId: string;
  version?: string;
  dryRun?: boolean;
}

export interface PullResult {
  skillId: string;
  version: string;
  files: number;
  writtenTo: string;
}

export async function pullSkill(options: PullOptions): Promise<PullResult> {
  const { client, state, skillId, version, dryRun } = options;
  const detail = await client.getSkill(skillId);
  const targetVersion = version ?? detail.latestPublishedVersion ?? detail.versions[0]?.version;
  if (!targetVersion) {
    throw new Error(`Skill ${skillId} has no usable version`);
  }

  const fileList = await client.listSkillFiles(skillId, targetVersion);
  if (!dryRun) {
    for (const file of fileList.items) {
      await downloadAndWrite(client, state, skillId, file, targetVersion);
    }
  }

  const localState = await state.load();
  const nextState: SyncState = {
    ...localState,
    registryUrl: client.baseUrl,
    lastSyncedAt: new Date().toISOString(),
    skills: {
      ...localState.skills,
      [skillId]: {
        skillUuid: detail.skillUuid,
        versionUuid:
          detail.versions.find((v) => v.version === targetVersion)?.versionUuid ?? detail.skillUuid,
        contentDigest:
          detail.versions.find((v) => v.version === targetVersion)?.contentDigest ?? '',
        version: targetVersion,
        title: detail.title,
        category: detail.category,
        entrypoint: detail.entrypoint,
        pulledAt: new Date().toISOString(),
        files: Object.fromEntries(fileList.items.map((f) => [f.artifactId, toSyncedFile(f)])),
      },
    },
  };
  if (!dryRun) {
    await state.save(nextState);
  }

  return {
    skillId,
    version: targetVersion,
    files: fileList.items.length,
    writtenTo: state.skillDir(skillId),
  };
}

export async function verifyLocalSha256(filePath: string, expectedSha256: string | null): Promise<boolean> {
  if (!expectedSha256) return true;
  try {
    const content = await import('node:fs/promises').then((fs) => fs.readFile(filePath));
    const hash = createHash('sha256').update(content).digest('hex');
    return hash === expectedSha256;
  } catch {
    return false;
  }
}
