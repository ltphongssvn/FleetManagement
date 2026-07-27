// apps/api/test/scheduler.service.intake-reconcile.test.ts
// Intake self-healing reconciler tick against the multi-provider registry
// (T9 arc). The reconciler is a SchedulerTicker (key=intakeReconcile, tag=
// intake-reconcile, 5-min interval) built as the module factory builds it. Its
// run() returns a result summary, which the scheduler discards. Dormancy now
// lives in the factory: when INTAKE_RECONCILE_ENABLED is false it omits the
// ticker, so no tick is scheduled and drainByKey is an inert no-op (there is no
// null-dep branch to exercise -- the absent ticker IS the dormant state).
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

const RESULT = { eligible: 0, emitted: 0, exhausted: 0 };
const cores = (): SchedulerTicker[] => coreTickers({
  outbox: () => undefined, projection: () => undefined, reconciler: () => undefined,
});

describe('@fleet/api - SchedulerService intake-reconcile tick (registry)', () => {
  beforeEach(() => { vi.useFakeTimers(); capturedTags.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('drainByKey(intakeReconcile) tags job=intake-reconcile and calls reconcileOnce', async () => {
    const reconcileOnce = vi.fn().mockResolvedValue(RESULT);
    const svc = new SchedulerService([...cores(), monitorTicker('intakeReconcile', () => reconcileOnce())]);
    await svc.drainByKey('intakeReconcile');
    expect(reconcileOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('intake-reconcile');
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules the reconcile at the 5-minute interval', async () => {
    const reconcileOnce = vi.fn().mockResolvedValue(RESULT);
    const svc = new SchedulerService([...cores(), monitorTicker('intakeReconcile', () => reconcileOnce())]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.intakeReconcile - 1);
    expect(reconcileOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(reconcileOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('keeps self-scheduling: a second tick fires another interval later', async () => {
    const reconcileOnce = vi.fn().mockResolvedValue(RESULT);
    const svc = new SchedulerService([...cores(), monitorTicker('intakeReconcile', () => reconcileOnce())]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.intakeReconcile + 1);
    await vi.advanceTimersByTimeAsync(INTERVALS.intakeReconcile + 1);
    expect(reconcileOnce).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });

  it('is dormant when the ticker is absent: nothing scheduled, drainByKey is a no-op', async () => {
    const svc = new SchedulerService(cores());
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(600_002);
    expect(capturedTags.find((t) => t.value === 'intake-reconcile')).toBeUndefined();
    // No ticker registered under this key: drainByKey does nothing and tags no scope.
    await svc.drainByKey('intakeReconcile');
    expect(capturedTags.find((t) => t.value === 'intake-reconcile')).toBeUndefined();
    svc.onModuleDestroy();
  });
});
