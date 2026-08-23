// apps/api/test/command-latency-recorder.test.ts
import { describe, it, expect } from 'vitest';
import {
  RingBufferLatencyRecorder,
  type CommandLatencyRecorder,
  type LatencySample,
} from '../src/commands/command-latency-recorder.js';

function s(ms: number, id = 'c'): LatencySample {
  return { ms, commandId: id, operatorId: 'o', recordedAt: new Date(), status: 'ok' };
}

describe('@fleet/api - RingBufferLatencyRecorder', () => {
  it('records a single sample', () => {
    const r: CommandLatencyRecorder = new RingBufferLatencyRecorder();
    r.record(s(123));
    expect(r.samples().map((x) => x.ms)).toEqual([123]);
  });

  it('preserves insertion order', () => {
    const r = new RingBufferLatencyRecorder();
    r.record(s(1));
    r.record(s(2));
    r.record(s(3));
    expect(r.samples().map((x) => x.ms)).toEqual([1, 2, 3]);
  });

  it('caps at configured capacity (default 100) using FIFO eviction', () => {
    const r = new RingBufferLatencyRecorder(3);
    r.record(s(1));
    r.record(s(2));
    r.record(s(3));
    r.record(s(4));
    expect(r.samples().map((x) => x.ms)).toEqual([2, 3, 4]);
  });

  it('default capacity is 100 (matches prior gateway behavior)', () => {
    const r = new RingBufferLatencyRecorder();
    for (let i = 0; i < 105; i++) r.record(s(i));
    const out = r.samples();
    expect(out.length).toBe(100);
    expect(out[0]?.ms).toBe(5);
    expect(out[99]?.ms).toBe(104);
  });

  it('samples() returns a defensive copy', () => {
    const r = new RingBufferLatencyRecorder();
    r.record(s(42));
    const a = r.samples();
    const b = r.samples();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('rejects non-finite values (NaN/Infinity guard)', () => {
    const r = new RingBufferLatencyRecorder();
    expect(() => {
      r.record(s(Number.NaN));
    }).toThrow(/finite/i);
    expect(() => {
      r.record(s(Number.POSITIVE_INFINITY));
    }).toThrow(/finite/i);
    expect(r.samples()).toEqual([]);
  });

  it('rejects negative values (latency cannot be negative)', () => {
    const r = new RingBufferLatencyRecorder();
    expect(() => {
      r.record(s(-1));
    }).toThrow(/non-negative/i);
  });
});
