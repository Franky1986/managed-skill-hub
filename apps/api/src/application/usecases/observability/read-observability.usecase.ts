import { ObservabilityPort } from '../../ports/outbound/observability.port';
import { mapObservabilitySnapshot, ObservabilitySnapshotDto } from './observability.snapshot';

export class ReadObservabilityUseCase {
  constructor(private readonly observability: ObservabilityPort) {}

  execute(): ObservabilitySnapshotDto {
    return mapObservabilitySnapshot(this.observability.getSnapshot());
  }
}
