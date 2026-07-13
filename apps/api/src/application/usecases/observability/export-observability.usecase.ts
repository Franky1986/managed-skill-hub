import { ObservabilityPort } from '../../ports/outbound/observability.port';
import { mapObservabilitySnapshot } from './observability.snapshot';

export type ObservabilityExportFormat = 'json' | 'csv';

export interface ObservabilityExportResult {
  body: string;
  contentType: string;
  fileName: string;
}

export class ExportObservabilityUseCase {
  constructor(private readonly observability: ObservabilityPort) {}

  execute(format: ObservabilityExportFormat = 'json'): ObservabilityExportResult {
    const snapshot = mapObservabilitySnapshot(this.observability.getSnapshot());
    if (format === 'csv') {
      return {
        body: buildCsv(snapshot),
        contentType: 'text/csv; charset=utf-8',
        fileName: `observability-${snapshot.generatedAt}.csv`,
      };
    }

    return {
      body: `${JSON.stringify(snapshot, null, 2)}\n`,
      contentType: 'application/json; charset=utf-8',
      fileName: `observability-${snapshot.generatedAt}.json`,
    };
  }
}

function buildCsv(snapshot: ReturnType<typeof mapObservabilitySnapshot>): string {
  const rows: string[][] = [
    [
      'section',
      'name',
      'area',
      'method',
      'route',
      'statusClass',
      'count',
      'lastObservedAt',
      'totalRequests',
      'errorRequests',
      'avgDurationMs',
      'p95DurationMs',
      'maxDurationMs',
      'bucketStart',
      'bucketEnd',
      'traceId',
      'url',
      'statusCode',
      'durationMs',
      'timestamp',
      'skillId',
      'proposalId',
      'fileId',
      'skillUuid',
      'versionUuid',
      'artifactId',
    ],
  ];

  for (const counter of snapshot.counters) {
    rows.push([
      'counter',
      counter.name,
      counter.area,
      counter.method,
      counter.route,
      counter.statusClass,
      String(counter.count),
      counter.lastObservedAt,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }

  for (const summary of snapshot.areaSummaries) {
    rows.push([
      'area_summary',
      '',
      summary.area,
      '',
      '',
      '',
      '',
      summary.lastObservedAt,
      String(summary.totalRequests),
      String(summary.errorRequests),
      String(summary.avgDurationMs),
      String(summary.p95DurationMs),
      String(summary.maxDurationMs),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }

  for (const bucket of snapshot.requestTimeline) {
    rows.push([
      'timeline_bucket',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      String(bucket.totalRequests),
      String(bucket.errorRequests),
      '',
      '',
      '',
      bucket.bucketStart,
      bucket.bucketEnd,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }

  for (const bucket of snapshot.latencyHistogram) {
    rows.push([
      'latency_histogram',
      bucket.label,
      '',
      '',
      '',
      '',
      String(bucket.count),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }

  for (const bucket of snapshot.hourlyRollups) {
    rows.push([
      'hourly_rollup',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      String(bucket.totalRequests),
      String(bucket.errorRequests),
      String(bucket.avgDurationMs),
      '',
      String(bucket.maxDurationMs),
      bucket.bucketStart,
      bucket.bucketEnd,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }

  for (const request of snapshot.recentRequests) {
    rows.push(serializeRequest('recent_request', request));
  }
  for (const request of snapshot.recentErrors) {
    rows.push(serializeRequest('recent_error', request));
  }

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

function serializeRequest(
  section: 'recent_request' | 'recent_error',
  request: ReturnType<typeof mapObservabilitySnapshot>['recentRequests'][number]
): string[] {
  return [
    section,
    '',
    request.area,
    request.method,
    request.route,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    request.traceId,
    request.url,
    String(request.statusCode),
    String(request.durationMs),
    request.timestamp,
    request.skillId ?? '',
    request.proposalId ?? '',
    request.fileId ?? '',
    request.skillUuid ?? '',
    request.versionUuid ?? '',
    request.artifactId ?? '',
  ];
}

function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
