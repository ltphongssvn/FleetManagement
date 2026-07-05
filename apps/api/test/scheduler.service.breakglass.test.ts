// apps/api/test/scheduler.service.breakglass.test.ts
// TDD for the break-glass poll tick wired into SchedulerService: an optional 5th
// monitor dependency, a 'breakglass' self-scheduling kind at 60s inside a tagged
// Sentry isolation scope, and dormancy when the monitor is absent (secret unset).
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
import type { BreakGlassLoginMonitorService } from '../src/security/break-glass-login-monitor.service.js';

const cfg = (): ConfigService => ({ get: vi.fn(), getOrThrow: vi.fn().mockReturnValue('scope') } as unknown as ConfigService);
const outbox = (): OutboxRelayService => ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService);
const proj = (): ProjectionRunnerService => ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService);
const gw = (): CommandsGateway => ({ reconcileNow: vi.fn().mockReturnValue([]) } as unknown as CommandsGateway);

describe('@fleet/api - SchedulerService break-glass tick', () => {
  beforeEach(() => { vi.useFakeTimers(); capturedTags.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('drainBreakglass tags Sentry scope job=breakglass-scan and calls monitor.pollOnce', async () => {
    const pollOnce = vi.fn().mockResolvedValue(undefined);
    const monitor = { pollOnce } as unknown as BreakGlassLoginMonitorService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), monitor);
    await svc.drainBreakglass();
    expect(pollOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('breakglass-scan');
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules the break-glass poll at 60s when a monitor is present', async () => {
    const pollOnce = vi.fn().mockResolvedValue(undefined);
    const monitor = { pollOnce } as unknown as BreakGlassLoginMonitorService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), monitor);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(pollOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(pollOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('is dormant when no monitor is provided: no 60s timer is ever scheduled', () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw());
    svc.onModuleInit();
    const sixtySecondTimers = setSpy.mock.calls.filter((c) => c[1] === 60_000);
    expect(sixtySecondTimers).toHaveLength(0);
    setSpy.mockRestore();
    svc.onModuleDestroy();
  });
});
