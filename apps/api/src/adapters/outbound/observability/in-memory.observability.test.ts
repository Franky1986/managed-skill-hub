import { describe, expect, it } from 'vitest';
import { InMemoryObservability } from './in-memory.observability';

describe('InMemoryObservability', () => {
  it('increments grouped request counters and keeps recent requests', () => {
    const adapter = new InMemoryObservability();

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
    adapter.recordHttpRequest({
      traceId: 'req-2',
      method: 'GET',
      route: '/skills/:skillId',
      url: '/skills/demo',
      statusCode: 200,
      durationMs: 8,
      area: 'retrieval',
      timestamp: new Date('2026-07-02T18:01:00.000Z'),
      skillId: 'demo',
      skillUuid: 'skill-uuid',
      versionUuid: null,
      artifactId: null,
    });

    const snapshot = adapter.getSnapshot();

    expect(snapshot.counters).toHaveLength(1);
    expect(snapshot.counters[0]).toMatchObject({
      name: 'http_requests_total',
      area: 'retrieval',
      method: 'GET',
      route: '/skills/:skillId',
      statusClass: '2xx',
      count: 2,
    });
    expect(snapshot.areaSummaries[0]).toMatchObject({
      area: 'retrieval',
      totalRequests: 2,
      errorRequests: 0,
      avgDurationMs: 11,
      p95DurationMs: 14,
      maxDurationMs: 14,
    });
    expect(snapshot.requestTimeline).toHaveLength(12);
    expect(snapshot.requestTimeline.some((bucket) => bucket.totalRequests > 0)).toBe(true);
    expect(snapshot.latencyHistogram).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '<=25ms', count: 2 }),
        expect.objectContaining({ label: '26-50ms', count: 0 }),
      ])
    );
    expect(snapshot.hourlyRollups).toHaveLength(24);
    expect(snapshot.hourlyRollups[snapshot.hourlyRollups.length - 1]).toMatchObject({
      totalRequests: 2,
      errorRequests: 0,
      avgDurationMs: 11,
      maxDurationMs: 14,
    });
    expect(snapshot.recentRequests[0]?.traceId).toBe('req-2');
    expect(snapshot.recentRequests[1]?.traceId).toBe('req-1');
    expect(snapshot.recentErrors).toHaveLength(0);
  });
});
