// apps/api/test/scheduler.service.completion-reconcile.test.ts
// Completion self-healing reconciler tick against the multi-provider registry
// (T32 arc). The reconciler is a SchedulerTicker (key=completionReconcile, tag=
// completion-reconcile, 5-min interval) built as the module factory builds it.
// run() returns a result summary the scheduler discards. Dormancy lives in the
// factory (omits the ticker when COMPLETION_RECONCILE_ENABLED is false): an
// absent ticker is the dormant state, so drainByKey is an inert no-op.
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

const RESULT = { tenants: 0, repaired: 0 };
const cores = (): SchedulerTicker[] =>
  coreTickers({
    outbox: () => undefined,
    projection: () => undefined,
    reconciler: () => undefined,
  });

describe('@fleet/api - SchedulerService completion-reconcile tick (registry)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedTags.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drainByKey(completionReconcile) tags job=completion-reconcile and calls reconcileOnce', async () => {
    const reconcileOnce = vi.fn().mockResolvedValue(RESULT);
    const svc = new SchedulerService([
      ...cores(),
      monitorTicker('completionReconcile', () => reconcileOnce()),
    ]);
    await svc.drainByKey('completionReconcile');
    expect(reconcileOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('completion-reconcile');
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules the completion reconcile at the 5-minute interval', async () => {
    const reconcileOnce = vi.fn().mockResolvedValue(RESULT);
    const svc = new SchedulerService([
      ...cores(),
      monitorTicker('completionReconcile', () => reconcileOnce()),
    ]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.completionReconcile - 1);
    expect(reconcileOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(reconcileOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('keeps self-scheduling: a second tick fires another interval later', async () => {
    const reconcileOnce = vi.fn().mockResolvedValue(RESULT);
    const svc = new SchedulerService([
      ...cores(),
      monitorTicker('completionReconcile', () => reconcileOnce()),
    ]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.completionReconcile + 1);
    await vi.advanceTimersByTimeAsync(INTERVALS.completionReconcile + 1);
    expect(reconcileOnce).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });

  it('is dormant when the ticker is absent: nothing scheduled, drainByKey is a no-op', async () => {
    const svc = new SchedulerService(cores());
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(600_002);
    expect(capturedTags.find((t) => t.value === 'completion-reconcile')).toBeUndefined();
    await svc.drainByKey('completionReconcile');
    expect(capturedTags.find((t) => t.value === 'completion-reconcile')).toBeUndefined();
    svc.onModuleDestroy();
  });
});
