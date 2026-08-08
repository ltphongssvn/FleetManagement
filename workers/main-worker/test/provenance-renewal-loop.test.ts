// workers/main-worker/test/provenance-renewal-loop.test.ts
// The renewal LOOP, proven by execution -- not by asserting its constants.
//
// WHY THIS EXISTS, and it is a correction to my own earlier work. The first
// renewal tests pinned only the numbers: refresh < ttl, ratio in [2,4], ms
// derived from seconds. Every one of them still passes if someone deletes the
// setInterval entirely. They assert INTENT, not BEHAVIOUR -- the same mistake
// that shipped a --reporter=dot "fix" whose flag never reached the tool: the
// unit test was green and the defect was untouched.
//
// A one-off curl 15 minutes after deploy is no better. It is an open loop
// dressed up as a closed one: it proves today and nothing afterwards. The
// durable form is to compress the interval and watch the write actually
// repeat -- the same shape as the real cadence, with no production risk and no
// waiting.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { startProvenanceRenewal } from '../src/boot-provenance.js';
afterEach(() => {
  vi.useRealTimers();
});
describe('provenance renewal loop', () => {
  it('writes AGAIN after one interval elapses (the whole point)', () => {
    vi.useFakeTimers();
    const writes: boolean[] = [];
    const handle = startProvenanceRenewal((first) => writes.push(first), 1000);
    expect(writes).toEqual([true]);
    vi.advanceTimersByTime(1000);
    expect(writes, 'a heartbeat that never repeats is a boot marker').toEqual([true, false]);
    handle.stop();
  });
  it('keeps renewing indefinitely, not just once', () => {
    vi.useFakeTimers();
    const writes: boolean[] = [];
    const handle = startProvenanceRenewal((first) => writes.push(first), 1000);
    vi.advanceTimersByTime(5000);
    expect(writes.length).toBe(6);
    handle.stop();
  });
  it('marks ONLY the first write as first, so renewals stay silent', () => {
    vi.useFakeTimers();
    const writes: boolean[] = [];
    const handle = startProvenanceRenewal((first) => writes.push(first), 1000);
    vi.advanceTimersByTime(3000);
    expect(writes.filter((w) => w).length, 'logging every renewal would drown the signal').toBe(1);
    handle.stop();
  });
  it('does NOT write before the interval elapses', () => {
    vi.useFakeTimers();
    const writes: boolean[] = [];
    const handle = startProvenanceRenewal((first) => writes.push(first), 1000);
    vi.advanceTimersByTime(999);
    expect(writes.length).toBe(1);
    handle.stop();
  });
  it('stops cleanly, so a shutdown is never blocked by a reporting concern', () => {
    vi.useFakeTimers();
    const writes: boolean[] = [];
    const handle = startProvenanceRenewal((first) => writes.push(first), 1000);
    handle.stop();
    vi.advanceTimersByTime(10_000);
    expect(writes.length, 'a stopped loop must not keep firing').toBe(1);
  });
  it('survives a throwing write: one failed renewal must not kill the loop', () => {
    vi.useFakeTimers();
    let calls = 0;
    const handle = startProvenanceRenewal(() => {
      calls += 1;
      if (calls === 2) throw new Error('redis blip');
    }, 1000);
    vi.advanceTimersByTime(3000);
    expect(calls, 'a Redis hiccup must not end the heartbeat permanently').toBe(4);
    handle.stop();
  });
});
