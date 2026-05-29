// apps/api/test/clock.test.ts
import { describe, it, expect } from 'vitest';
import { SystemClock, type Clock } from '../src/common/clock.js';

describe('@fleet/api - Clock', () => {
  it('SystemClock.now() returns current Date', () => {
    const c: Clock = new SystemClock();
    const before = Date.now();
    const t = c.now();
    const after = Date.now();
    expect(t).toBeInstanceOf(Date);
    expect(t.getTime()).toBeGreaterThanOrEqual(before);
    expect(t.getTime()).toBeLessThanOrEqual(after);
  });

  it('Clock interface allows test doubles to control time', () => {
    const fixed = new Date('2026-05-02T10:00:00Z');
    const fake: Clock = { now: () => fixed };
    expect(fake.now()).toBe(fixed);
    expect(fake.now()).toBe(fixed); // stable across calls
  });
});
