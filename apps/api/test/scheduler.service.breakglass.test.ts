// apps/api/test/scheduler.service.breakglass.test.ts
// Break-glass poll tick against the multi-provider registry. The monitor is a
// SchedulerTicker (key=breakglass, tag=breakglass-scan, 60s interval) built as
// the module factory builds it. Dormancy (secret unset) lives in the factory:
// it omits the ticker, so no 60s timer is armed -- modelled here by leaving the
// breakglass ticker out of the list.
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

describe('@fleet/api - SchedulerService break-glass tick (registry)', () => {
  beforeEach(() => { vi.useFakeTimers(); capturedTags.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('drainByKey(breakglass) tags job=breakglass-scan and calls monitor.pollOnce', async () => {
    const pollOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('breakglass', () => pollOnce())]);
    await svc.drainByKey('breakglass');
    expect(pollOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('breakglass-scan');
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules the break-glass poll at the 60s interval', async () => {
    const pollOnce = vi.fn().mockResolvedValue(undefined);
    const svc = new SchedulerService([...cores(), monitorTicker('breakglass', () => pollOnce())]);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.breakglass - 1);
    expect(pollOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(pollOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('is dormant when the ticker is absent: no 60s timer is ever scheduled', () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const svc = new SchedulerService(cores());
    svc.onModuleInit();
    const sixtySecondTimers = setSpy.mock.calls.filter((c) => c[1] === INTERVALS.breakglass);
    expect(sixtySecondTimers).toHaveLength(0);
    setSpy.mockRestore();
    svc.onModuleDestroy();
  });
});
