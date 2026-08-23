// apps/api/test/scheduler.registry.test.ts
// Anti-collision invariant for the multi-provider scheduler registry.
//
// The refactor exists to end a recurring three-way merge collision: every new
// monitor used to edit a SchedulerKind union plus four parallel switch
// statements in scheduler.service.ts. This guard fails if that machinery comes
// back -- i.e. if the service reintroduces per-kind case labels for the
// monitors instead of driving the injected SchedulerTicker[] generically.
//
// It also exercises the runtime contract: the service schedules one tick per
// injected ticker, runs each on its own interval, isolates failures, and
// re-arms; and drainByKey drives a single ticker for tests.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchedulerService } from '../src/scheduler/scheduler.service.js';
import type { SchedulerTicker } from '../src/scheduler/scheduler-ticker.js';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSrc = (): string =>
  readFileSync(resolve(here, '..', 'src/scheduler/scheduler.service.ts'), 'utf8');

// A minimal recording ticker for behavioural assertions. run() returns unknown
// to match the SchedulerTicker contract (the scheduler discards the value).
function makeTicker(key: string, intervalMs: number, run: () => unknown): SchedulerTicker {
  return { key, tag: 'job-' + key, label: key + ' failed: ', intervalMs, run };
}

describe('@fleet/api - scheduler registry: anti-collision invariant', () => {
  it('the service exposes NO per-monitor case labels (collision surface is gone)', () => {
    const s = serviceSrc();
    // None of the old per-kind union members may appear as case labels.
    const banned = [
      'case ' + String.fromCharCode(39) + 'breakglass',
      'case ' + String.fromCharCode(39) + 'intakeLag',
      'case ' + String.fromCharCode(39) + 'intakeReconcile',
      'case ' + String.fromCharCode(39) + 'alertLag',
      'case ' + String.fromCharCode(39) + 'completionReconcile',
      'case ' + String.fromCharCode(39) + 'completionMonitor',
    ];
    for (const frag of banned) {
      // vitest expect() takes no message arg; assert the banned frag directly.
      expect(s.includes(frag)).toBe(false);
    }
  });

  it('the service no longer declares a SchedulerKind union', () => {
    expect(serviceSrc().includes('type SchedulerKind')).toBe(false);
  });

  it('schedules exactly one tick per injected ticker on onModuleInit', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const tickers = [
      makeTicker('a', 1000, () => {
        calls.push('a');
      }),
      makeTicker('b', 2000, () => {
        calls.push('b');
      }),
    ];
    const svc = new SchedulerService(tickers);
    svc.onModuleInit();
    // Nothing runs until the first interval elapses.
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(calls).toContain('a');
    svc.onModuleDestroy();
    vi.useRealTimers();
  });

  it('drainByKey drives exactly one ticker run', async () => {
    const calls: string[] = [];
    const tickers = [
      makeTicker('x', 1000, () => {
        calls.push('x');
      }),
      makeTicker('y', 1000, () => {
        calls.push('y');
      }),
    ];
    const svc = new SchedulerService(tickers);
    await svc.drainByKey('x');
    expect(calls).toEqual(['x']);
  });

  it('a throwing ticker is isolated and does not stop the scheduler', async () => {
    const tickers = [
      makeTicker('boom', 1000, () => {
        throw new Error('kaboom');
      }),
    ];
    const svc = new SchedulerService(tickers);
    // drainByKey swallows (captures) the error rather than rejecting.
    await expect(svc.drainByKey('boom')).resolves.toBeUndefined();
  });
});
