import {
  HttpRequestObservation,
  ObservabilityArea,
  ObservabilityCounterRecord,
  ObservabilityPort,
} from '../../../application/ports/outbound/observability.port';
import {
  buildObservabilitySnapshot,
  MAX_RECENT_REQUESTS,
  MutableObservabilityAreaStats,
  upsertAreaStats,
  upsertCounter,
} from './observability-metrics';

export class InMemoryObservability implements ObservabilityPort {
  private readonly counters = new Map<string, ObservabilityCounterRecord>();
  private readonly areaStats = new Map<ObservabilityArea, MutableObservabilityAreaStats>();
  private recentRequests: HttpRequestObservation[] = [];

  recordHttpRequest(observation: HttpRequestObservation): void {
    upsertCounter(this.counters, observation);
    upsertAreaStats(this.areaStats, observation);
    this.recentRequests = [observation, ...this.recentRequests].slice(0, MAX_RECENT_REQUESTS);
  }

  getSnapshot() {
    return buildObservabilitySnapshot(this.counters, this.areaStats, this.recentRequests);
  }
}
