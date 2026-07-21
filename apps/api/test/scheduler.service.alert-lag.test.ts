// apps/api/test/scheduler.service.alert-lag.test.ts
// S6c (T12 driver-order-alerts) -- TDD for the alert-lag guard tick wired into
// SchedulerService: an optional 7th monitor dependency, an alertLag
// self-scheduling kind inside a tagged Sentry isolation scope. Mirrors
// scheduler.service.intake-lag.test.ts exactly. Dormant unless an
// AlertLagMonitorService is injected (present iff the wiring provides it).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
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
import type { OutboxRelayService } from '../src/outbox/outbox-relay.service.js';
import type { ProjectionRunnerService } from '../src/projections/projection-runner.service.js';
import type { CommandsGateway } from '../src/commands/commands.gateway.js';
import type { AlertLagMonitorService } from '../src/manifest/alert-lag-monitor.service.js';

const cfg = (): ConfigService => ({ get: vi.fn(), getOrThrow: vi.fn().mockReturnValue('scope') } as unknown as ConfigService);
const outbox = (): OutboxRelayService => ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService);
const proj = (): ProjectionRunnerService => ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService);
const gw = (): CommandsGateway => ({ reconcileNow: vi.fn().mockReturnValue([]) } as unknown as CommandsGateway);

// Constructor arg order: outbox, proj, cfg, gw, breakGlass, intakeLag,
// intakeReconcile, completionReconcile, alertLag. All monitor slots after gw
// are optional; we pass null for the four we are not exercising and the alert
// monitor 9th (completion reconciler occupies the 8th slot on develop).
function makeSvc(monitor: AlertLagMonitorService | null): SchedulerService {
  return new SchedulerService(outbox(), proj(), cfg() as never, gw(), null, null, null, null, monitor);
}

describe('@fleet/api - SchedulerService alert-lag tick', () => {
  beforeEach(() => { vi.useFakeTimers(); capturedTags.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('drainAlertLag tags Sentry scope job=driver-alert-lag-check and calls monitor.checkOnce', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const monitor = { checkOnce } as unknown as AlertLagMonitorService;
    const svc = makeSvc(monitor);
    await svc.drainAlertLag();
    expect(checkOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('driver-alert-lag-check');
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules the alert-lag check when a monitor is present', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const monitor = { checkOnce } as unknown as AlertLagMonitorService;
    const svc = makeSvc(monitor);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(checkOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(checkOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('keeps self-scheduling: a second tick fires another interval later', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const monitor = { checkOnce } as unknown as AlertLagMonitorService;
    const svc = makeSvc(monitor);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(300_001);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(checkOnce).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });

  it('is dormant when no monitor is provided: no alert-lag timer is scheduled', () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const svc = makeSvc(null);
    svc.onModuleInit();
    // intake-lag also uses 300_000; with all lag monitors null here, NO 300s
    // timer should be scheduled at all, so a zero count isolates the alert tick.
    const fiveMinuteTimers = setSpy.mock.calls.filter((c) => c[1] === 300_000);
    expect(fiveMinuteTimers).toHaveLength(0);
    setSpy.mockRestore();
    svc.onModuleDestroy();
  });
});
