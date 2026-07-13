import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { FileBackedObservability } from './file-backed.observability';

describe('FileBackedObservability', () => {
  it('persists counters and recent requests to disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'observability-'));
    const snapshotPath = path.join(dir, 'observability.json');
    const adapter = new FileBackedObservability(snapshotPath);

    adapter.recordHttpRequest({
      traceId: 'req-1',
      method: 'get',
      route: '/skills/:skillId',
      url: '/skills/demo',
      statusCode: 200,
      durationMs: 14,
      area: 'retrieval',
      timestamp: new Date('2026-07-02T18:00:00.000Z'),
      skillId: 'demo',
      skillUuid: 'skill-uuid',
      versionUuid: null,
      artifactId: null,
    });

    const persisted = await waitForSnapshot(snapshotPath);

    expect(persisted.counters).toHaveLength(1);
    expect(persisted.counters[0]).toMatchObject({
      count: 1,
      method: 'GET',
      route: '/skills/:skillId',
    });
    expect(persisted.areaSummaries?.[0]).toMatchObject({
      area: 'retrieval',
      totalRequests: 1,
      errorRequests: 0,
      maxDurationMs: 14,
    });
    expect(persisted.hourlyRollups?.[0]).toMatchObject({
      totalRequests: 1,
      errorRequests: 0,
      avgDurationMs: 14,
      maxDurationMs: 14,
    });
    expect(persisted.recentRequests[0]?.traceId).toBe('req-1');
  });

  it('hydrates counters and recent requests from an existing snapshot file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'observability-'));
    const snapshotPath = path.join(dir, 'observability.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        counters: [
          {
            name: 'http_requests_total',
            area: 'proposal',
            method: 'POST',
            route: '/proposals',
            statusClass: '2xx',
            count: 3,
            lastObservedAt: '2026-07-02T18:05:00.000Z',
          },
        ],
        recentRequests: [
          {
            traceId: 'req-3',
            method: 'POST',
            route: '/proposals',
            url: '/proposals',
            statusCode: 201,
            durationMs: 33,
            area: 'proposal',
            timestamp: '2026-07-02T18:05:00.000Z',
            proposalId: 'proposal-1',
          },
        ],
        areaSummaries: [
          {
            area: 'proposal',
            totalRequests: 3,
            errorRequests: 1,
            avgDurationMs: 30,
            p95DurationMs: 33,
            maxDurationMs: 33,
            lastObservedAt: '2026-07-02T18:05:00.000Z',
            totalDurationMs: 90,
          },
        ],
        hourlyRollups: [
          {
            bucketStart: '2026-07-02T18:05:00.000Z',
            bucketEnd: '2026-07-02T19:00:00.000Z',
            totalRequests: 3,
            errorRequests: 1,
            avgDurationMs: 30,
            maxDurationMs: 33,
            totalDurationMs: 90,
          },
        ],
      })
    );

    const adapter = new FileBackedObservability(snapshotPath);
    const snapshot = adapter.getSnapshot();

    expect(snapshot.counters[0]).toMatchObject({
      name: 'http_requests_total',
      area: 'proposal',
      method: 'POST',
      route: '/proposals',
      count: 3,
    });
    expect(snapshot.recentRequests[0]).toMatchObject({
      traceId: 'req-3',
      proposalId: 'proposal-1',
    });
    expect(snapshot.areaSummaries[0]).toMatchObject({
      area: 'proposal',
      totalRequests: 3,
      errorRequests: 1,
      avgDurationMs: 30,
      maxDurationMs: 33,
    });
    expect(snapshot.requestTimeline).toHaveLength(12);
    expect(snapshot.latencyHistogram).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '26-50ms', count: 1 }),
      ])
    );
    expect(snapshot.hourlyRollups[snapshot.hourlyRollups.length - 1]).toMatchObject({
      totalRequests: 3,
      errorRequests: 1,
      avgDurationMs: 30,
      maxDurationMs: 33,
    });
  });

  it('keeps timeline and latency trend data beyond the recent request sample size', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'observability-'));
    const snapshotPath = path.join(dir, 'observability.json');
    const adapter = new FileBackedObservability(snapshotPath);

    for (let index = 0; index < 55; index += 1) {
      adapter.recordHttpRequest({
        traceId: `req-${index}`,
        method: 'GET',
        route: '/skills/:skillId',
        url: '/skills/demo',
        statusCode: index % 10 === 0 ? 500 : 200,
        durationMs: 18,
        area: 'retrieval',
        timestamp: new Date('2026-07-02T18:10:15.000Z'),
        skillId: 'demo',
      });
    }

    const snapshot = adapter.getSnapshot();
    const hottestBucket = snapshot.requestTimeline[snapshot.requestTimeline.length - 1];

    expect(snapshot.recentRequests).toHaveLength(50);
    expect(hottestBucket).toMatchObject({
      totalRequests: 55,
      errorRequests: 6,
    });
    expect(snapshot.latencyHistogram).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '<=25ms', count: 55 }),
      ])
    );
    expect(snapshot.hourlyRollups[snapshot.hourlyRollups.length - 1]).toMatchObject({
      totalRequests: 55,
      errorRequests: 6,
      avgDurationMs: 18,
      maxDurationMs: 18,
    });
  });
});

async function waitForSnapshot(filePath: string): Promise<{
  counters: Array<{ count: number; method: string; route: string }>;
  areaSummaries?: Array<{ area: string; totalRequests: number; errorRequests: number; maxDurationMs: number }>;
  hourlyRollups?: Array<{ totalRequests: number; errorRequests: number; avgDurationMs: number; maxDurationMs: number }>;
  recentRequests: Array<{ traceId: string }>;
}> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.length === 0) continue;
        return JSON.parse(content) as ReturnType<typeof waitForSnapshot>;
      } catch {
        // File may be mid-write; retry.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for persisted snapshot at ${filePath}`);
}
