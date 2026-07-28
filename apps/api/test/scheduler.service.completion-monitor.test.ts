// apps/api/test/scheduler.service.completion-monitor.test.ts
// Completion-stranded proactive monitor tick (T16 guard) against the multi-
// provider registry. The monitor is a SchedulerTicker (key=completionMonitor,
// tag=completion-monitor-check, 5-min interval) built as the module factory
// builds it. Dormancy now lives in the factory (it omits the ticker when
// COMPLETION_MONITOR_ENABLED is false): an absent ticker is the dormant state,
// so drainByKey is an inert no-op (no null-dep branch to exercise).
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

const cores = (): SchedulerTicker[] => coreTickers({
  outbox: () => undefined, projection: () => undefined, reconciler: () => undefined,
});

describe('@fleet/api - SchedulerService completion-monitor tick (registry)', () => {
  beforeEach(() => { vi.useFakeTimers(); capturedTags.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('drainByKey(completionMonitor) tags job=completion-monitor-check and calls checkOnce', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('completionMonitor', () => checkOnce())]);
    await svc.drainByKey('completionMonitor');
    expect(checkOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('completion-monitor-check');
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules the completion check at the 5-minute interval', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('completionMonitor', () => checkOnce())]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.completionMonitor - 1);
    expect(checkOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(checkOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('keeps self-scheduling: a second tick fires another interval later', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('completionMonitor', () => checkOnce())]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.completionMonitor + 1);
    await vi.advanceTimersByTimeAsync(INTERVALS.completionMonitor + 1);
    expect(checkOnce).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });

  it('is dormant when the ticker is absent: nothing scheduled, drainByKey is a no-op', async () => {
    const svc = new SchedulerService(cores());
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(600_002);
    expect(capturedTags.find((t) => t.value === 'completion-monitor-check')).toBeUndefined();
    await svc.drainByKey('completionMonitor');
    expect(capturedTags.find((t) => t.value === 'completion-monitor-check')).toBeUndefined();
    svc.onModuleDestroy();
  });
});
