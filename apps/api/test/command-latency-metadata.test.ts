// apps/api/test/command-latency-metadata.test.ts
import { describe, it, expect } from 'vitest';
import {
  RingBufferLatencyRecorder,
  type CommandLatencyRecorder,
  type LatencySample,
} from '../src/commands/command-latency-recorder.js';

describe('@fleet/api - LatencySample metadata', () => {
  it('records full sample with metadata, not just primitive number', () => {
    const r: CommandLatencyRecorder = new RingBufferLatencyRecorder();
    const sample: LatencySample = {
      ms: 250,
      commandId: '11111111-1111-4111-8111-111111111111',
      operatorId: '22222222-2222-4222-8222-222222222222',
      recordedAt: new Date('2026-05-02T10:00:00.000Z'),
      status: 'ok',
    };
    r.record(sample);
    expect(r.samples()).toEqual([sample]);
  });

  it('preserves rejected status for SLO drill-down', () => {
    const r = new RingBufferLatencyRecorder();
    r.record({
      ms: 50,
      commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operatorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      recordedAt: new Date(),
      status: 'rejected',
    });
    expect(r.samples()[0]?.status).toBe('rejected');
  });

  it('still rejects non-finite ms', () => {
    const r = new RingBufferLatencyRecorder();
    expect(() => {
      r.record({ ms: Number.NaN, commandId: 'c', operatorId: 'o', recordedAt: new Date(), status: 'ok' });
    }).toThrow(/finite/i);
  });

  it('still rejects negative ms', () => {
    const r = new RingBufferLatencyRecorder();
    expect(() => {
      r.record({ ms: -1, commandId: 'c', operatorId: 'o', recordedAt: new Date(), status: 'ok' });
    }).toThrow(/non-negative/i);
  });

  it('FIFO eviction at capacity preserves last N samples', () => {
    const r = new RingBufferLatencyRecorder(2);
    for (let i = 0; i < 3; i++) {
      r.record({ ms: i, commandId: `c${String(i)}`, operatorId: 'o', recordedAt: new Date(), status: 'ok' });
    }
    expect(r.samples().map((s) => s.ms)).toEqual([1, 2]);
  });
});
