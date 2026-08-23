// apps/api/test/scheduler.service.intake-lag.test.ts
// Intake-lag guard tick against the multi-provider registry. The monitor is a
// SchedulerTicker (key=intakeLag, tag=intake-lag-check, 5-min interval) built as
// the module factory builds it. Dormancy now lives in the factory (it omits the
// ticker when the monitor is null), modelled here by not including the ticker.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { mockWithIsolationScope, mockCaptureException, capturedTags } = vi.hoisted(() => {
  const capturedTags: { key: string; value: unknown }[] = [];
  return {
    capturedTags,
    mockCaptureException: vi.fn(),
    mockWithIsolationScope: vi.fn(
      async (fn: (s: { setTag: (k: string, v: unknown) => void }) => Promise<void>) => {
        await fn({
          setTag: (k, v) => {
            capturedTags.push({ key: k, value: v });
          },
        });
      },
    ),
  };
});
vi.mock('@sentry/nestjs', () => ({
  withIsolationScope: mockWithIsolationScope,
  captureException: mockCaptureException,
}));
import { SchedulerService } from '../src/scheduler/scheduler.service.js';
import { monitorTicker, coreTickers, INTERVALS } from './helpers/scheduler-ticker-factory.js';
import type { SchedulerTicker } from '../src/scheduler/scheduler-ticker.js';

const cores = (): SchedulerTicker[] =>
  coreTickers({
    outbox: () => undefined,
    projection: () => undefined,
    reconciler: () => undefined,
  });

describe('@fleet/api - SchedulerService intake-lag tick (registry)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedTags.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drainByKey(intakeLag) tags job=intake-lag-check and calls monitor.checkOnce', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('intakeLag', () => checkOnce())]);
    await svc.drainByKey('intakeLag');
    expect(checkOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('intake-lag-check');
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules the intake-lag check at the 5-minute interval', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('intakeLag', () => checkOnce())]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.intakeLag - 1);
    expect(checkOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(checkOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('keeps self-scheduling: a second tick fires another interval later', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('intakeLag', () => checkOnce())]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.intakeLag + 1);
    await vi.advanceTimersByTimeAsync(INTERVALS.intakeLag + 1);
    expect(checkOnce).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });

  it('is dormant when the ticker is absent: no intake-lag timer is scheduled', () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const svc = new SchedulerService(cores());
    svc.onModuleInit();
    const fiveMinuteTimers = setSpy.mock.calls.filter((c) => c[1] === INTERVALS.intakeLag);
    expect(fiveMinuteTimers).toHaveLength(0);
    setSpy.mockRestore();
    svc.onModuleDestroy();
  });
});
