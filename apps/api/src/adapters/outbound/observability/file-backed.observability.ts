import fs from 'fs';
import path from 'path';
import {
  ObservabilityArea,
  ObservabilityLatencyHistogramBucket,
  ObservabilityCounterRecord,
  HttpRequestObservation,
  ObservabilityHourlyRollup,
  ObservabilityPort,
  ObservabilityTimelineBucket,
} from '../../../application/ports/outbound/observability.port';
import {
  buildObservabilitySnapshot,
  HOURLY_ROLLUP_BUCKET_MS,
  LATENCY_BUCKETS,
  MAX_RECENT_REQUESTS,
  MutableObservabilityAreaStats,
  TIMELINE_BUCKET_MS,
  matchesLatencyBucket,
  upsertAreaStats,
  upsertCounter,
} from './observability-metrics';

const PERSISTED_TIMELINE_HISTORY_BUCKETS = 60;
const SNAPSHOT_TIMELINE_BUCKETS = 12;
const PERSISTED_HOURLY_ROLLUP_BUCKETS = 72;
const SNAPSHOT_HOURLY_ROLLUP_BUCKETS = 24;

interface MutableHourlyRollupStats extends ObservabilityHourlyRollup {
  totalDurationMs: number;
}

interface PersistedObservabilitySnapshot {
  counters: Array<{
    name: string;
    area: ObservabilityCounterRecord['area'];
    method: string;
    route: string;
    statusClass: string;
    count: number;
    lastObservedAt: string;
  }>;
  recentRequests: Array<{
    traceId: string;
    method: string;
    route: string;
    url: string;
    statusCode: number;
    durationMs: number;
    area: HttpRequestObservation['area'];
    timestamp: string;
    skillId?: string | null;
    proposalId?: string | null;
    fileId?: string | null;
    skillUuid?: string | null;
    versionUuid?: string | null;
    artifactId?: string | null;
  }>;
  areaSummaries?: Array<{
    area: ObservabilityArea;
    totalRequests: number;
    errorRequests: number;
    avgDurationMs?: number;
    p95DurationMs?: number;
    maxDurationMs: number;
    lastObservedAt: string;
    totalDurationMs?: number;
  }>;
  timelineHistory?: Array<{
    bucketStart: string;
    bucketEnd: string;
    totalRequests: number;
    errorRequests: number;
  }>;
  latencyHistogram?: Array<{
    label: string;
    minDurationMs: number;
    maxDurationMs: number | null;
    count: number;
  }>;
  hourlyRollups?: Array<{
    bucketStart: string;
    bucketEnd: string;
    totalRequests: number;
    errorRequests: number;
    avgDurationMs?: number;
    maxDurationMs: number;
    totalDurationMs?: number;
  }>;
}

export class FileBackedObservability implements ObservabilityPort {
  private readonly counters = new Map<string, ObservabilityCounterRecord>();
  private readonly areaStats = new Map<ObservabilityArea, MutableObservabilityAreaStats>();
  private readonly timelineHistory = new Map<number, ObservabilityTimelineBucket>();
  private readonly latencyHistogram = new Map<string, ObservabilityLatencyHistogramBucket>();
  private readonly hourlyRollups = new Map<number, MutableHourlyRollupStats>();
  private recentRequests: HttpRequestObservation[] = [];
  private writeScheduled = false;

  constructor(private readonly snapshotPath: string) {
    this.initializeLatencyHistogram();
    this.loadPersistedSnapshot();
  }

  recordHttpRequest(observation: HttpRequestObservation): void {
    upsertCounter(this.counters, observation);
    upsertAreaStats(this.areaStats, observation);
    this.upsertTimelineHistory(observation);
    this.upsertLatencyHistogram(observation);
    this.upsertHourlyRollup(observation);
    this.recentRequests = [observation, ...this.recentRequests].slice(0, MAX_RECENT_REQUESTS);
    this.schedulePersist();
  }

  getSnapshot() {
    const snapshot = buildObservabilitySnapshot(this.counters, this.areaStats, this.recentRequests);
    return {
      ...snapshot,
      requestTimeline: this.buildTimelineFromHistory(),
      latencyHistogram: this.buildLatencyHistogramFromHistory(),
      hourlyRollups: this.buildHourlyRollupsFromHistory(),
    };
  }

  private loadPersistedSnapshot(): void {
    try {
      if (!fs.existsSync(this.snapshotPath)) {
        return;
      }
      const raw = fs.readFileSync(this.snapshotPath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedObservabilitySnapshot;
      this.counters.clear();
      for (const counter of parsed.counters ?? []) {
        const key = [
          counter.name,
          counter.area,
          counter.method.toUpperCase(),
          counter.route,
          counter.statusClass,
        ].join('|');
        this.counters.set(key, {
          ...counter,
          method: counter.method.toUpperCase(),
          lastObservedAt: new Date(counter.lastObservedAt),
        });
      }
      this.recentRequests = (parsed.recentRequests ?? []).map((request) => ({
        ...request,
        method: request.method.toUpperCase(),
        timestamp: new Date(request.timestamp),
      }));
      this.areaStats.clear();
      if ((parsed.areaSummaries ?? []).length > 0) {
        for (const summary of parsed.areaSummaries ?? []) {
          this.areaStats.set(summary.area, {
            area: summary.area,
            totalRequests: summary.totalRequests,
            errorRequests: summary.errorRequests,
            totalDurationMs:
              typeof summary.totalDurationMs === 'number'
                ? summary.totalDurationMs
                : (summary.avgDurationMs ?? 0) * summary.totalRequests,
            maxDurationMs: summary.maxDurationMs,
            lastObservedAt: new Date(summary.lastObservedAt),
          });
        }
      } else {
        for (const request of this.recentRequests) {
          upsertAreaStats(this.areaStats, request);
        }
      }
      this.timelineHistory.clear();
      if ((parsed.timelineHistory ?? []).length > 0) {
        for (const bucket of parsed.timelineHistory ?? []) {
          const bucketStart = new Date(bucket.bucketStart);
          this.timelineHistory.set(bucketStart.getTime(), {
            bucketStart,
            bucketEnd: new Date(bucket.bucketEnd),
            totalRequests: bucket.totalRequests,
            errorRequests: bucket.errorRequests,
          });
        }
      } else {
        for (const request of this.recentRequests) {
          this.upsertTimelineHistory(request);
        }
      }
      this.initializeLatencyHistogram();
      if ((parsed.latencyHistogram ?? []).length > 0) {
        for (const bucket of parsed.latencyHistogram ?? []) {
          this.latencyHistogram.set(bucket.label, {
            label: bucket.label,
            minDurationMs: bucket.minDurationMs,
            maxDurationMs: bucket.maxDurationMs,
            count: bucket.count,
          });
        }
      } else {
        for (const request of this.recentRequests) {
          this.upsertLatencyHistogram(request);
        }
      }
      this.hourlyRollups.clear();
      if ((parsed.hourlyRollups ?? []).length > 0) {
        for (const bucket of parsed.hourlyRollups ?? []) {
          const bucketStart = new Date(bucket.bucketStart);
          this.hourlyRollups.set(bucketStart.getTime(), {
            bucketStart,
            bucketEnd: new Date(bucket.bucketEnd),
            totalRequests: bucket.totalRequests,
            errorRequests: bucket.errorRequests,
            avgDurationMs:
              typeof bucket.avgDurationMs === 'number'
                ? bucket.avgDurationMs
                : Math.round((bucket.totalDurationMs ?? 0) / Math.max(bucket.totalRequests, 1)),
            maxDurationMs: bucket.maxDurationMs,
            totalDurationMs:
              typeof bucket.totalDurationMs === 'number'
                ? bucket.totalDurationMs
                : (bucket.avgDurationMs ?? 0) * bucket.totalRequests,
          });
        }
      } else {
        for (const request of this.recentRequests) {
          this.upsertHourlyRollup(request);
        }
      }
    } catch {
      this.counters.clear();
      this.areaStats.clear();
      this.timelineHistory.clear();
      this.initializeLatencyHistogram();
      this.hourlyRollups.clear();
      this.recentRequests = [];
    }
  }

  private schedulePersist(): void {
    if (this.writeScheduled) {
      return;
    }
    this.writeScheduled = true;
    queueMicrotask(() => {
      this.writeScheduled = false;
      void this.persistSnapshot();
    });
  }

  private async persistSnapshot(): Promise<void> {
    try {
      await fs.promises.mkdir(path.dirname(this.snapshotPath), { recursive: true });
      const snapshot: PersistedObservabilitySnapshot = {
        counters: [...this.counters.values()].map((counter) => ({
          ...counter,
          lastObservedAt: counter.lastObservedAt.toISOString(),
        })),
        areaSummaries: [...this.areaStats.values()].map((summary) => ({
          area: summary.area,
          totalRequests: summary.totalRequests,
          errorRequests: summary.errorRequests,
          avgDurationMs: Math.round(summary.totalDurationMs / Math.max(summary.totalRequests, 1)),
          p95DurationMs: 0,
          maxDurationMs: summary.maxDurationMs,
          lastObservedAt: summary.lastObservedAt.toISOString(),
          totalDurationMs: summary.totalDurationMs,
        })),
        timelineHistory: [...this.timelineHistory.values()].map((bucket) => ({
          bucketStart: bucket.bucketStart.toISOString(),
          bucketEnd: bucket.bucketEnd.toISOString(),
          totalRequests: bucket.totalRequests,
          errorRequests: bucket.errorRequests,
        })),
        latencyHistogram: [...this.latencyHistogram.values()].map((bucket) => ({
          label: bucket.label,
          minDurationMs: bucket.minDurationMs,
          maxDurationMs: bucket.maxDurationMs,
          count: bucket.count,
        })),
        hourlyRollups: [...this.hourlyRollups.values()].map((bucket) => ({
          bucketStart: bucket.bucketStart.toISOString(),
          bucketEnd: bucket.bucketEnd.toISOString(),
          totalRequests: bucket.totalRequests,
          errorRequests: bucket.errorRequests,
          avgDurationMs: bucket.avgDurationMs,
          maxDurationMs: bucket.maxDurationMs,
          totalDurationMs: bucket.totalDurationMs,
        })),
        recentRequests: this.recentRequests.map((request) => ({
          ...request,
          method: request.method.toUpperCase(),
          timestamp: request.timestamp.toISOString(),
        })),
      };
      await fs.promises.writeFile(this.snapshotPath, JSON.stringify(snapshot, null, 2));
    } catch {
      // Observability persistence must never block request handling.
    }
  }

  private initializeLatencyHistogram(): void {
    this.latencyHistogram.clear();
    for (const bucket of LATENCY_BUCKETS) {
      this.latencyHistogram.set(bucket.label, {
        label: bucket.label,
        minDurationMs: bucket.minDurationMs,
        maxDurationMs: bucket.maxDurationMs,
        count: 0,
      });
    }
  }

  private upsertTimelineHistory(observation: HttpRequestObservation): void {
    const bucketStartTime = Math.floor(observation.timestamp.getTime() / TIMELINE_BUCKET_MS) * TIMELINE_BUCKET_MS;
    const existing = this.timelineHistory.get(bucketStartTime);
    this.timelineHistory.set(bucketStartTime, {
      bucketStart: new Date(bucketStartTime),
      bucketEnd: new Date(bucketStartTime + TIMELINE_BUCKET_MS),
      totalRequests: (existing?.totalRequests ?? 0) + 1,
      errorRequests: (existing?.errorRequests ?? 0) + (observation.statusCode >= 400 ? 1 : 0),
    });
    this.pruneTimelineHistory(bucketStartTime);
  }

  private pruneTimelineHistory(latestBucketStartTime: number): void {
    const threshold = latestBucketStartTime - (PERSISTED_TIMELINE_HISTORY_BUCKETS - 1) * TIMELINE_BUCKET_MS;
    for (const bucketStartTime of this.timelineHistory.keys()) {
      if (bucketStartTime < threshold) {
        this.timelineHistory.delete(bucketStartTime);
      }
    }
  }

  private upsertLatencyHistogram(observation: HttpRequestObservation): void {
    const bucket = LATENCY_BUCKETS.find((candidate) => matchesLatencyBucket(observation.durationMs, candidate));
    if (!bucket) {
      return;
    }
    const existing = this.latencyHistogram.get(bucket.label);
    if (!existing) {
      return;
    }
    this.latencyHistogram.set(bucket.label, {
      ...existing,
      count: existing.count + 1,
    });
  }

  private buildTimelineFromHistory(): ObservabilityTimelineBucket[] {
    const latestBucketStartTime =
      this.timelineHistory.size > 0
        ? Math.max(...this.timelineHistory.keys())
        : Math.floor(Date.now() / TIMELINE_BUCKET_MS) * TIMELINE_BUCKET_MS;
    const buckets: ObservabilityTimelineBucket[] = [];
    for (let index = SNAPSHOT_TIMELINE_BUCKETS - 1; index >= 0; index -= 1) {
      const bucketStartTime = latestBucketStartTime - index * TIMELINE_BUCKET_MS;
      const existing = this.timelineHistory.get(bucketStartTime);
      buckets.push(
        existing ?? {
          bucketStart: new Date(bucketStartTime),
          bucketEnd: new Date(bucketStartTime + TIMELINE_BUCKET_MS),
          totalRequests: 0,
          errorRequests: 0,
        }
      );
    }
    return buckets;
  }

  private buildLatencyHistogramFromHistory(): ObservabilityLatencyHistogramBucket[] {
    return LATENCY_BUCKETS.map((bucket) => this.latencyHistogram.get(bucket.label) ?? {
      label: bucket.label,
      minDurationMs: bucket.minDurationMs,
      maxDurationMs: bucket.maxDurationMs,
      count: 0,
    });
  }

  private upsertHourlyRollup(observation: HttpRequestObservation): void {
    const bucketStartTime =
      Math.floor(observation.timestamp.getTime() / HOURLY_ROLLUP_BUCKET_MS) * HOURLY_ROLLUP_BUCKET_MS;
    const existing = this.hourlyRollups.get(bucketStartTime);
    const totalRequests = (existing?.totalRequests ?? 0) + 1;
    const totalDurationMs = (existing?.totalDurationMs ?? 0) + observation.durationMs;
    this.hourlyRollups.set(bucketStartTime, {
      bucketStart: new Date(bucketStartTime),
      bucketEnd: new Date(bucketStartTime + HOURLY_ROLLUP_BUCKET_MS),
      totalRequests,
      errorRequests: (existing?.errorRequests ?? 0) + (observation.statusCode >= 400 ? 1 : 0),
      avgDurationMs: Math.round(totalDurationMs / Math.max(totalRequests, 1)),
      maxDurationMs: Math.max(existing?.maxDurationMs ?? 0, observation.durationMs),
      totalDurationMs,
    });
    this.pruneHourlyRollups(bucketStartTime);
  }

  private pruneHourlyRollups(latestBucketStartTime: number): void {
    const threshold = latestBucketStartTime - (PERSISTED_HOURLY_ROLLUP_BUCKETS - 1) * HOURLY_ROLLUP_BUCKET_MS;
    for (const bucketStartTime of this.hourlyRollups.keys()) {
      if (bucketStartTime < threshold) {
        this.hourlyRollups.delete(bucketStartTime);
      }
    }
  }

  private buildHourlyRollupsFromHistory(): ObservabilityHourlyRollup[] {
    const latestBucketStartTime =
      this.hourlyRollups.size > 0
        ? Math.max(...this.hourlyRollups.keys())
        : Math.floor(Date.now() / HOURLY_ROLLUP_BUCKET_MS) * HOURLY_ROLLUP_BUCKET_MS;
    const buckets: ObservabilityHourlyRollup[] = [];
    for (let index = SNAPSHOT_HOURLY_ROLLUP_BUCKETS - 1; index >= 0; index -= 1) {
      const bucketStartTime = latestBucketStartTime - index * HOURLY_ROLLUP_BUCKET_MS;
      const existing = this.hourlyRollups.get(bucketStartTime);
      buckets.push(
        existing ?? {
          bucketStart: new Date(bucketStartTime),
          bucketEnd: new Date(bucketStartTime + HOURLY_ROLLUP_BUCKET_MS),
          totalRequests: 0,
          errorRequests: 0,
          avgDurationMs: 0,
          maxDurationMs: 0,
        }
      );
    }
    return buckets;
  }
}
