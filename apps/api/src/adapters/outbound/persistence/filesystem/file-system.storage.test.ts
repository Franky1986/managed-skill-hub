import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { FileSystemSkillStorage } from './file-system.storage';
import { StorageError } from '../../../../domain/errors';

describe('FileSystemSkillStorage', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('persists extracted skill file content on disk', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-storage-'));
    tempDirs.push(dataDir);

    const storage = new FileSystemSkillStorage(dataDir);

    await storage.storeSkillFileExtract('skill-a', '1.0.0', 'README.md', {
      text: '# Hello',
      extractedBy: 'native',
      metadata: { mimeType: 'text/markdown', filePath: 'README.md' },
    });

    const loaded = await storage.readSkillFileExtract('skill-a', '1.0.0', 'README.md');

    expect(loaded).not.toBeNull();
    expect(loaded?.text).toBe('# Hello');
    expect(loaded?.extractedBy).toBe('native');
    expect(loaded?.metadata).toEqual({ mimeType: 'text/markdown', filePath: 'README.md' });
  });

  it('persists extracted proposal file content on disk', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-storage-'));
    tempDirs.push(dataDir);

    const storage = new FileSystemSkillStorage(dataDir);

    await storage.storeProposalFileExtract('proposal-a', 'brief.pdf', {
      text: 'Extracted proposal text',
      extractedBy: 'liteparse',
      metadata: { mimeType: 'application/pdf', filePath: 'brief.pdf' },
    });

    const loaded = await storage.readProposalFileExtract('proposal-a', 'brief.pdf');

    expect(loaded).not.toBeNull();
    expect(loaded?.text).toBe('Extracted proposal text');
    expect(loaded?.extractedBy).toBe('liteparse');
    expect(loaded?.metadata).toEqual({ mimeType: 'application/pdf', filePath: 'brief.pdf' });
  });

  it('rejects skill file paths that escape the storage directory', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-storage-'));
    tempDirs.push(dataDir);

    const storage = new FileSystemSkillStorage(dataDir);

    await expect(
      storage.storeSkillFile('skill-a', '1.0.0', '../secret.txt', Buffer.from('secret'), 'text/plain')
    ).rejects.toBeInstanceOf(StorageError);
    await expect(storage.readSkillFile('skill-a', '1.0.0', '../secret.txt')).rejects.toBeInstanceOf(StorageError);
  });

  it('rejects proposal file paths that escape the storage directory', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-storage-'));
    tempDirs.push(dataDir);

    const storage = new FileSystemSkillStorage(dataDir);

    await expect(
      storage.storeProposalFile('proposal-a', '/absolute.txt', Buffer.from('secret'), 'text/plain')
    ).rejects.toBeInstanceOf(StorageError);
    await expect(storage.readProposalFile('proposal-a', '/absolute.txt')).rejects.toBeInstanceOf(StorageError);
  });

  it('rejects storage identifiers that escape their entity directory', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'managed-skill-hub-storage-'));
    tempDirs.push(dataDir);
    const storage = new FileSystemSkillStorage(dataDir);

    await expect(storage.readProposalFile('../..', 'README.md')).rejects.toBeInstanceOf(StorageError);
    await expect(storage.readSkillFile('../skill-a', '1.0.0', 'README.md')).rejects.toBeInstanceOf(StorageError);
    await expect(storage.readSkillFile('skill-a', '../1.0.0', 'README.md')).rejects.toBeInstanceOf(StorageError);
  });
});
