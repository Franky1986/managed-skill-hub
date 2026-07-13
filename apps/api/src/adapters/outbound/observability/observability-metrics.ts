import {
  HttpRequestObservation,
  ObservabilityArea,
  ObservabilityAreaSummary,
  ObservabilityCounterRecord,
  ObservabilityHourlyRollup,
  ObservabilityLatencyHistogramBucket,
  ObservabilitySnapshot,
  ObservabilityTimelineBucket,
} from '../../../application/ports/outbound/observability.port';

export const MAX_RECENT_REQUESTS = 50;
const MAX_RECENT_ERRORS = 20;
const TIMELINE_BUCKET_COUNT = 12;
export const TIMELINE_BUCKET_MS = 60_000;
const HOURLY_ROLLUP_BUCKET_COUNT = 24;
export const HOURLY_ROLLUP_BUCKET_MS = 3_600_000;
export const LATENCY_BUCKETS: Array<{ label: string; minDurationMs: number; maxDurationMs: number | null }> = [
  { label: '<=25ms', minDurationMs: 0, maxDurationMs: 25 },
  { label: '26-50ms', minDurationMs: 26, maxDurationMs: 50 },
  { label: '51-100ms', minDurationMs: 51, maxDurationMs: 100 },
  { label: '101-250ms', minDurationMs: 101, maxDurationMs: 250 },
  { label: '251-500ms', minDurationMs: 251, maxDurationMs: 500 },
  { label: '>500ms', minDurationMs: 501, maxDurationMs: null },
];

export interface MutableObservabilityAreaStats {
  area: ObservabilityArea;
  totalRequests: number;
  errorRequests: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastObservedAt: Date;
}

export function buildCounterKey(observation: HttpRequestObservation, statusClass: string): string {
  return [
    'http_requests_total',
    observation.area,
    observation.method.toUpperCase(),
    observation.route,
    statusClass,
  ].join('|');
}

export function upsertCounter(
  counters: Map<string, ObservabilityCounterRecord>,
  observation: HttpRequestObservation
): void {
  const statusClass = `${Math.floor(observation.statusCode / 100)}xx`;
  const key = buildCounterKey(observation, statusClass);
  const existing = counters.get(key);

  counters.set(key, {
    name: 'http_requests_total',
    area: observation.area,
    method: observation.method.toUpperCase(),
    route: observation.route,
    statusClass,
    count: (existing?.count ?? 0) + 1,
    lastObservedAt: observation.timestamp,
  });
}

export function upsertAreaStats(
  areaStats: Map<ObservabilityArea, MutableObservabilityAreaStats>,
  observation: HttpRequestObservation
): void {
  const existing = areaStats.get(observation.area);
  areaStats.set(observation.area, {
    area: observation.area,
    totalRequests: (existing?.totalRequests ?? 0) + 1,
    errorRequests: (existing?.errorRequests ?? 0) + (observation.statusCode >= 400 ? 1 : 0),
    totalDurationMs: (existing?.totalDurationMs ?? 0) + observation.durationMs,
    maxDurationMs: Math.max(existing?.maxDurationMs ?? 0, observation.durationMs),
    lastObservedAt: observation.timestamp,
  });
}

export function buildObservabilitySnapshot(
  counters: Map<string, ObservabilityCounterRecord>,
  areaStats: Map<ObservabilityArea, MutableObservabilityAreaStats>,
  recentRequests: HttpRequestObservation[]
): ObservabilitySnapshot {
  return {
    generatedAt: new Date(),
    counters: [...counters.values()].sort((left, right) => {
      return right.lastObservedAt.getTime() - left.lastObservedAt.getTime();
    }),
    areaSummaries: [...areaStats.values()]
      .map((stats) => buildAreaSummary(stats, recentRequests))
      .sort((left, right) => right.lastObservedAt.getTime() - left.lastObservedAt.getTime()),
    requestTimeline: buildTimeline(recentRequests),
    latencyHistogram: buildLatencyHistogram(recentRequests),
    hourlyRollups: buildHourlyRollups(recentRequests),
    recentRequests: [...recentRequests],
    recentErrors: recentRequests.filter((request) => request.statusCode >= 400).slice(0, MAX_RECENT_ERRORS),
  };
}

function buildAreaSummary(
  stats: MutableObservabilityAreaStats,
  recentRequests: HttpRequestObservation[]
): ObservabilityAreaSummary {
  const areaDurations = recentRequests
    .filter((request) => request.area === stats.area)
    .map((request) => request.durationMs)
    .sort((left, right) => left - right);

  return {
    area: stats.area,
    totalRequests: stats.totalRequests,
    errorRequests: stats.errorRequests,
    avgDurationMs: roundToInt(stats.totalDurationMs / Math.max(stats.totalRequests, 1)),
    p95DurationMs: percentile(areaDurations, 0.95),
    maxDurationMs: stats.maxDurationMs,
    lastObservedAt: stats.lastObservedAt,
  };
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1));
  return values[index] ?? 0;
}

function roundToInt(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function buildTimeline(recentRequests: HttpRequestObservation[]): ObservabilityTimelineBucket[] {
  const referenceTime = recentRequests[0]?.timestamp ?? new Date();
  const alignedEnd = new Date(Math.floor(referenceTime.getTime() / TIMELINE_BUCKET_MS) * TIMELINE_BUCKET_MS + TIMELINE_BUCKET_MS);
  const buckets: ObservabilityTimelineBucket[] = [];

  for (let index = TIMELINE_BUCKET_COUNT - 1; index >= 0; index -= 1) {
    const bucketStart = new Date(alignedEnd.getTime() - (index + 1) * TIMELINE_BUCKET_MS);
    const bucketEnd = new Date(bucketStart.getTime() + TIMELINE_BUCKET_MS);
    const inBucket = recentRequests.filter(
      (request) => request.timestamp >= bucketStart && request.timestamp < bucketEnd
    );
    buckets.push({
      bucketStart,
      bucketEnd,
      totalRequests: inBucket.length,
      errorRequests: inBucket.filter((request) => request.statusCode >= 400).length,
    });
  }

  return buckets;
}

function buildLatencyHistogram(
  recentRequests: HttpRequestObservation[]
): ObservabilityLatencyHistogramBucket[] {
  return LATENCY_BUCKETS.map((bucket) => ({
    label: bucket.label,
    minDurationMs: bucket.minDurationMs,
    maxDurationMs: bucket.maxDurationMs,
    count: recentRequests.filter((request) => matchesLatencyBucket(request.durationMs, bucket)).length,
  }));
}

function buildHourlyRollups(recentRequests: HttpRequestObservation[]): ObservabilityHourlyRollup[] {
  const referenceTime = recentRequests[0]?.timestamp ?? new Date();
  const alignedEnd =
    new Date(Math.floor(referenceTime.getTime() / HOURLY_ROLLUP_BUCKET_MS) * HOURLY_ROLLUP_BUCKET_MS + HOURLY_ROLLUP_BUCKET_MS);
  const buckets: ObservabilityHourlyRollup[] = [];

  for (let index = HOURLY_ROLLUP_BUCKET_COUNT - 1; index >= 0; index -= 1) {
    const bucketStart = new Date(alignedEnd.getTime() - (index + 1) * HOURLY_ROLLUP_BUCKET_MS);
    const bucketEnd = new Date(bucketStart.getTime() + HOURLY_ROLLUP_BUCKET_MS);
    const inBucket = recentRequests.filter(
      (request) => request.timestamp >= bucketStart && request.timestamp < bucketEnd
    );
    const totalDurationMs = inBucket.reduce((sum, request) => sum + request.durationMs, 0);
    buckets.push({
      bucketStart,
      bucketEnd,
      totalRequests: inBucket.length,
      errorRequests: inBucket.filter((request) => request.statusCode >= 400).length,
      avgDurationMs: roundToInt(totalDurationMs / Math.max(inBucket.length, 1)),
      maxDurationMs: Math.max(0, ...inBucket.map((request) => request.durationMs)),
    });
  }

  return buckets;
}

export function matchesLatencyBucket(
  durationMs: number,
  bucket: { minDurationMs: number; maxDurationMs: number | null }
): boolean {
  if (durationMs < bucket.minDurationMs) {
    return false;
  }
  if (bucket.maxDurationMs === null) {
    return true;
  }
  return durationMs <= bucket.maxDurationMs;
}
