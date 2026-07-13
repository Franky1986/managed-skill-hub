import { ObservabilitySnapshot } from '../../ports/outbound/observability.port';

export interface ObservabilitySnapshotDto {
  generatedAt: string;
  counters: Array<{
    name: string;
    area: string;
    method: string;
    route: string;
    statusClass: string;
    count: number;
    lastObservedAt: string;
  }>;
  areaSummaries: Array<{
    area: string;
    totalRequests: number;
    errorRequests: number;
    avgDurationMs: number;
    p95DurationMs: number;
    maxDurationMs: number;
    lastObservedAt: string;
  }>;
  requestTimeline: Array<{
    bucketStart: string;
    bucketEnd: string;
    totalRequests: number;
    errorRequests: number;
  }>;
  latencyHistogram: Array<{
    label: string;
    minDurationMs: number;
    maxDurationMs: number | null;
    count: number;
  }>;
  hourlyRollups: Array<{
    bucketStart: string;
    bucketEnd: string;
    totalRequests: number;
    errorRequests: number;
    avgDurationMs: number;
    maxDurationMs: number;
  }>;
  recentRequests: Array<{
    traceId: string;
    method: string;
    route: string;
    url: string;
    statusCode: number;
    durationMs: number;
    area: string;
    timestamp: string;
    skillId?: string | null;
    proposalId?: string | null;
    fileId?: string | null;
    skillUuid?: string | null;
    versionUuid?: string | null;
    artifactId?: string | null;
  }>;
  recentErrors: Array<{
    traceId: string;
    method: string;
    route: string;
    url: string;
    statusCode: number;
    durationMs: number;
    area: string;
    timestamp: string;
    skillId?: string | null;
    proposalId?: string | null;
    fileId?: string | null;
    skillUuid?: string | null;
    versionUuid?: string | null;
    artifactId?: string | null;
  }>;
}

export function mapObservabilitySnapshot(snapshot: ObservabilitySnapshot): ObservabilitySnapshotDto {
  return {
    generatedAt: snapshot.generatedAt.toISOString(),
    counters: snapshot.counters.map((counter) => ({
      name: counter.name,
      area: counter.area,
      method: counter.method,
      route: counter.route,
      statusClass: counter.statusClass,
      count: counter.count,
      lastObservedAt: counter.lastObservedAt.toISOString(),
    })),
    areaSummaries: snapshot.areaSummaries.map((summary) => ({
      area: summary.area,
      totalRequests: summary.totalRequests,
      errorRequests: summary.errorRequests,
      avgDurationMs: summary.avgDurationMs,
      p95DurationMs: summary.p95DurationMs,
      maxDurationMs: summary.maxDurationMs,
      lastObservedAt: summary.lastObservedAt.toISOString(),
    })),
    requestTimeline: snapshot.requestTimeline.map((bucket) => ({
      bucketStart: bucket.bucketStart.toISOString(),
      bucketEnd: bucket.bucketEnd.toISOString(),
      totalRequests: bucket.totalRequests,
      errorRequests: bucket.errorRequests,
    })),
    latencyHistogram: snapshot.latencyHistogram.map((bucket) => ({
      label: bucket.label,
      minDurationMs: bucket.minDurationMs,
      maxDurationMs: bucket.maxDurationMs,
      count: bucket.count,
    })),
    hourlyRollups: snapshot.hourlyRollups.map((bucket) => ({
      bucketStart: bucket.bucketStart.toISOString(),
      bucketEnd: bucket.bucketEnd.toISOString(),
      totalRequests: bucket.totalRequests,
      errorRequests: bucket.errorRequests,
      avgDurationMs: bucket.avgDurationMs,
      maxDurationMs: bucket.maxDurationMs,
    })),
    recentRequests: snapshot.recentRequests.map((request) => ({
      traceId: request.traceId,
      method: request.method,
      route: request.route,
      url: request.url,
      statusCode: request.statusCode,
      durationMs: request.durationMs,
      area: request.area,
      timestamp: request.timestamp.toISOString(),
      skillId: request.skillId,
      proposalId: request.proposalId,
      fileId: request.fileId,
      skillUuid: request.skillUuid,
      versionUuid: request.versionUuid,
      artifactId: request.artifactId,
    })),
    recentErrors: snapshot.recentErrors.map((request) => ({
      traceId: request.traceId,
      method: request.method,
      route: request.route,
      url: request.url,
      statusCode: request.statusCode,
      durationMs: request.durationMs,
      area: request.area,
      timestamp: request.timestamp.toISOString(),
      skillId: request.skillId,
      proposalId: request.proposalId,
      fileId: request.fileId,
      skillUuid: request.skillUuid,
      versionUuid: request.versionUuid,
      artifactId: request.artifactId,
    })),
  };
}
