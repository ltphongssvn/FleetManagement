// apps/api/test/scheduler.service.intake-lag.test.ts
// TDD for the intake-lag guard tick wired into SchedulerService (slice G of
// the phieu-photo-visibility arc): an optional 6th monitor dependency, an
// intakeLag self-scheduling kind at 300s inside a tagged Sentry isolation
// scope. Mirrors scheduler.service.breakglass.test.ts exactly.
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
import type { IntakeLagMonitorService } from '../src/manifest/intake-lag-monitor.service.js';
const cfg = (): ConfigService => ({ get: vi.fn(), getOrThrow: vi.fn().mockReturnValue('scope') } as unknown as ConfigService);
const outbox = (): OutboxRelayService => ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService);
const proj = (): ProjectionRunnerService => ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService);
const gw = (): CommandsGateway => ({ reconcileNow: vi.fn().mockReturnValue([]) } as unknown as CommandsGateway);
describe('@fleet/api - SchedulerService intake-lag tick', () => {
  beforeEach(() => { vi.useFakeTimers(); capturedTags.length = 0; });
  afterEach(() => { vi.useRealTimers(); });
  it('drainIntakeLag tags Sentry scope job=intake-lag-check and calls monitor.checkOnce', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const monitor = { checkOnce } as unknown as IntakeLagMonitorService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), null, monitor);
    await svc.drainIntakeLag();
    expect(checkOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('intake-lag-check');
    svc.onModuleDestroy();
  });
  it('onModuleInit schedules the intake-lag check at 300s when a monitor is present', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const monitor = { checkOnce } as unknown as IntakeLagMonitorService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), null, monitor);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(checkOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(checkOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });
  it('keeps self-scheduling: a second tick fires another 300s later', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const monitor = { checkOnce } as unknown as IntakeLagMonitorService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), null, monitor);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(300_001);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(checkOnce).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });
  it('is dormant when no monitor is provided: no 300s timer is ever scheduled', () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw());
    svc.onModuleInit();
    const fiveMinuteTimers = setSpy.mock.calls.filter((c) => c[1] === 300_000);
    expect(fiveMinuteTimers).toHaveLength(0);
    setSpy.mockRestore();
    svc.onModuleDestroy();
  });
});
