import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteSkillSearch } from './sqlite.search';

describe('SqliteSkillSearch', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to fuzzy token matching when FTS finds no exact prefix match', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'skill-search-'));
    tempDirs.push(dir);
    const search = new SqliteSkillSearch(path.join(dir, 'search.db'));

    await search.reindexAll([
      {
        skillId: 'ffmpeg-local-video',
        version: '1.0.0',
        title: 'Local FFmpeg Video Skill',
        description: 'Guidance for local video workflows.',
        category: 'media',
        groups: ['media', 'video'],
        capabilities: ['ffmpeg'],
        body: 'Trim and verify video files.',
        publishedAt: new Date('2026-07-08T10:00:00.000Z'),
      },
    ]);

    const result = await search.search('vido', 'keyword');

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      skillId: 'ffmpeg-local-video',
      version: '1.0.0',
    });
    expect(result.items[0]?.score).toBeGreaterThan(0);
  });
});
