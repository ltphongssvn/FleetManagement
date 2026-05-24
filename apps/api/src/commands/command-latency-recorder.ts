// apps/api/src/commands/command-latency-recorder.ts
// Command-delivery latency instrumentation, extracted from CommandsGateway
// to separate metrics-collection concern from WS protocol translation.
// Per PDF SLOs: "Command delivery p95 <2s" — recorder feeds the histogram
// that backs that SLO. Default impl is an in-memory ring buffer used in
// pilot; per ADR-004 "Future Work", this seam will be swapped for an OTel
// histogram when the Redis Streams adapter trigger fires (multi-instance
// requires export-only telemetry).

const DEFAULT_CAPACITY = 100;

export interface LatencySample {
  readonly ms: number;
  readonly commandId: string;
  readonly operatorId: string;
  readonly recordedAt: Date;
  readonly status: 'ok' | 'rejected';
}

export interface CommandLatencyRecorder {
  record(sample: LatencySample): void;
  samples(): readonly LatencySample[];
}

export class RingBufferLatencyRecorder implements CommandLatencyRecorder {
  private readonly buffer: LatencySample[] = [];
  private readonly capacity: number;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`capacity must be a positive integer, got ${String(capacity)}`);
    }
    this.capacity = capacity;
  }

  record(sample: LatencySample): void {
    if (!Number.isFinite(sample.ms)) {
      throw new Error(`latency must be finite, got ${String(sample.ms)}`);
    }
    if (sample.ms < 0) {
      throw new Error(`latency must be non-negative, got ${String(sample.ms)}`);
    }
    this.buffer.push(sample);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  samples(): readonly LatencySample[] {
    return [...this.buffer];
  }
}

export const COMMAND_LATENCY_RECORDER = Symbol('CommandLatencyRecorder');
