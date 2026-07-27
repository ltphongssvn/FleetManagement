// apps/api/test/scheduler.service.alert-lag.test.ts
// S6c (T12) alert-lag guard tick, re-expressed against the multi-provider
// registry: the monitor is a SchedulerTicker (key=alertLag, tag=
// driver-alert-lag-check, 5-min interval) built exactly as the module factory
// builds it (helpers/scheduler-ticker-factory). The service drives it
// generically; these tests assert the tick runs the monitor, tags the scope,
// self-schedules, and that WITHOUT the ticker nothing is scheduled (dormancy
// now lives in the module factory, which omits the ticker when the monitor is
// null).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { mockWithIsolationScope, mockCaptureException, capturedTags } = vi.hoisted(() => {
  const capturedTags: { key: string; value: unknown }[] = [];
  return {
    capturedTags,
    mockCaptureException: vi.fn(),
    mockWithIsolationScope: vi.fn(async (fn: (s: { setTag: (k: string, v: unknown) => void }) => Promise<void>) => {
      await fn({ setTag: (k, v) => { capturedTags.push({ key: k, value: v }); } });
    }),
  };
});
vi.mock('@sentry/nestjs', () => ({ withIsolationScope: mockWithIsolationScope, captureException: mockCaptureException }));
import { SchedulerService } from '../src/scheduler/scheduler.service.js';
import { monitorTicker, coreTickers, INTERVALS } from './helpers/scheduler-ticker-factory.js';
import type { SchedulerTicker } from '../src/scheduler/scheduler-ticker.js';

// Core ticks are inert no-ops here; we only exercise the alert-lag ticker.
const cores = (): SchedulerTicker[] => coreTickers({
  outbox: () => undefined, projection: () => undefined, reconciler: () => undefined,
});

describe('@fleet/api - SchedulerService alert-lag tick (registry)', () => {
  beforeEach(() => { vi.useFakeTimers(); capturedTags.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('drainByKey(alertLag) tags job=driver-alert-lag-check and calls monitor.checkOnce', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('alertLag', () => checkOnce())]);
    await svc.drainByKey('alertLag');
    expect(checkOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('driver-alert-lag-check');
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules the alert-lag check at the 5-minute interval', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('alertLag', () => checkOnce())]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.alertLag - 1);
    expect(checkOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(checkOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('keeps self-scheduling: a second tick fires another interval later', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('alertLag', () => checkOnce())]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.alertLag + 1);
    await vi.advanceTimersByTimeAsync(INTERVALS.alertLag + 1);
    expect(checkOnce).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });

  it('is dormant when the ticker is absent: no alert-lag timer is scheduled', () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    // Module factory omits the alertLag ticker when the monitor is null; model
    // that by simply not including it. No 300s timer should be armed.
    const svc = new SchedulerService(cores());
    svc.onModuleInit();
    const fiveMinuteTimers = setSpy.mock.calls.filter((c) => c[1] === INTERVALS.alertLag);
    expect(fiveMinuteTimers).toHaveLength(0);
    setSpy.mockRestore();
    svc.onModuleDestroy();
  });
});
