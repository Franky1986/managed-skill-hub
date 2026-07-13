export type ObservabilityArea =
  | 'retrieval'
  | 'viewer'
  | 'proposal'
  | 'review'
  | 'publish'
  | 'extraction'
  | 'auth'
  | 'observability'
  | 'other';

export interface HttpRequestObservation {
  traceId: string;
  method: string;
  route: string;
  url: string;
  statusCode: number;
  durationMs: number;
  area: ObservabilityArea;
  timestamp: Date;
  skillId?: string | null;
  proposalId?: string | null;
  fileId?: string | null;
  skillUuid?: string | null;
  versionUuid?: string | null;
  artifactId?: string | null;
}

export interface ObservabilityCounterRecord {
  name: string;
  area: ObservabilityArea;
  method: string;
  route: string;
  statusClass: string;
  count: number;
  lastObservedAt: Date;
}

export interface ObservabilityAreaSummary {
  area: ObservabilityArea;
  totalRequests: number;
  errorRequests: number;
  avgDurationMs: number;
  p95DurationMs: number;
  maxDurationMs: number;
  lastObservedAt: Date;
}

export interface ObservabilityTimelineBucket {
  bucketStart: Date;
  bucketEnd: Date;
  totalRequests: number;
  errorRequests: number;
}

export interface ObservabilityLatencyHistogramBucket {
  label: string;
  minDurationMs: number;
  maxDurationMs: number | null;
  count: number;
}

export interface ObservabilityHourlyRollup {
  bucketStart: Date;
  bucketEnd: Date;
  totalRequests: number;
  errorRequests: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

export interface ObservabilitySnapshot {
  generatedAt: Date;
  counters: ObservabilityCounterRecord[];
  areaSummaries: ObservabilityAreaSummary[];
  requestTimeline: ObservabilityTimelineBucket[];
  latencyHistogram: ObservabilityLatencyHistogramBucket[];
  hourlyRollups: ObservabilityHourlyRollup[];
  recentRequests: HttpRequestObservation[];
  recentErrors: HttpRequestObservation[];
}

export interface ObservabilityPort {
  recordHttpRequest(observation: HttpRequestObservation): void;
  getSnapshot(): ObservabilitySnapshot;
}
