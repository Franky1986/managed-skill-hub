import { describe, expect, it } from 'vitest';
import {
  HttpRequestObservation,
  ObservabilityAreaSummary,
  ObservabilityCounterRecord,
  ObservabilityPort,
  ObservabilitySnapshot,
} from '../../ports/outbound/observability.port';
import { ExportObservabilityUseCase } from './export-observability.usecase';

describe('ExportObservabilityUseCase', () => {
  it('exports the current snapshot as formatted json', () => {
    const useCase = new ExportObservabilityUseCase(new ObservabilityStub());

    const result = useCase.execute('json');

    expect(result.contentType).toBe('application/json; charset=utf-8');
    expect(result.fileName).toContain('observability-2026-07-02T19:00:00.000Z.json');
    expect(result.body).toContain('"areaSummaries"');
    expect(result.body).toContain('"recentErrors"');
    expect(result.body).toContain('"requestTimeline"');
    expect(result.body).toContain('"latencyHistogram"');
    expect(result.body).toContain('"hourlyRollups"');
  });

  it('exports counters, area summaries and request sections as csv', () => {
    const useCase = new ExportObservabilityUseCase(new ObservabilityStub());

    const result = useCase.execute('csv');

    expect(result.contentType).toBe('text/csv; charset=utf-8');
    expect(result.fileName).toContain('observability-2026-07-02T19:00:00.000Z.csv');
    expect(result.body).toContain('section,name,area,method,route');
    expect(result.body).toContain('counter,http_requests_total,retrieval,GET,/skills/:skillId,2xx,5');
    expect(result.body).toContain('area_summary,,retrieval');
    expect(result.body).toContain('timeline_bucket');
    expect(result.body).toContain('latency_histogram');
    expect(result.body).toContain('hourly_rollup');
    expect(result.body).toContain('recent_error,,review,POST,/admin/skills/demo/publish');
  });
});

class ObservabilityStub implements ObservabilityPort {
  recordHttpRequest(_observation: HttpRequestObservation): void {}

  getSnapshot(): ObservabilitySnapshot {
    return {
      generatedAt: new Date('2026-07-02T19:00:00.000Z'),
      counters: [
        {
          name: 'http_requests_total',
          area: 'retrieval',
          method: 'GET',
          route: '/skills/:skillId',
          statusClass: '2xx',
          count: 5,
          lastObservedAt: new Date('2026-07-02T19:00:00.000Z'),
        } satisfies ObservabilityCounterRecord,
      ],
      areaSummaries: [
        {
          area: 'retrieval',
          totalRequests: 5,
          errorRequests: 1,
          avgDurationMs: 24,
          p95DurationMs: 41,
          maxDurationMs: 55,
          lastObservedAt: new Date('2026-07-02T19:00:00.000Z'),
        } satisfies ObservabilityAreaSummary,
      ],
      requestTimeline: [
        {
          bucketStart: new Date('2026-07-02T18:59:00.000Z'),
          bucketEnd: new Date('2026-07-02T19:00:00.000Z'),
          totalRequests: 3,
          errorRequests: 1,
        },
      ],
      latencyHistogram: [
        {
          label: '<=25ms',
          minDurationMs: 0,
          maxDurationMs: 25,
          count: 1,
        },
      ],
      hourlyRollups: [
        {
          bucketStart: new Date('2026-07-02T18:00:00.000Z'),
          bucketEnd: new Date('2026-07-02T19:00:00.000Z'),
          totalRequests: 5,
          errorRequests: 1,
          avgDurationMs: 24,
          maxDurationMs: 55,
        },
      ],
      recentRequests: [
        {
          traceId: 'req-1',
          method: 'GET',
          route: '/skills/:skillId',
          url: '/skills/demo',
          statusCode: 200,
          durationMs: 21,
          area: 'retrieval',
          timestamp: new Date('2026-07-02T19:00:00.000Z'),
          skillId: 'demo',
        },
      ],
      recentErrors: [
        {
          traceId: 'req-err',
          method: 'POST',
          route: '/admin/skills/demo/publish',
          url: '/admin/skills/demo/publish',
          statusCode: 500,
          durationMs: 88,
          area: 'review',
          timestamp: new Date('2026-07-02T19:01:00.000Z'),
          skillId: 'demo',
        },
      ],
    };
  }
}
