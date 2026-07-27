// apps/api/test/scheduler.service.completion-monitor.test.ts
// TDD for the completion-stranded proactive monitor tick wired into
// SchedulerService (T16 guard arc): an optional 8th monitor dependency, a
// completionMonitor self-scheduling kind at 300s inside a tagged Sentry
// isolation scope. Mirrors scheduler.service.intake-reconcile.test.ts exactly.
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
import type { CompletionReconcilerMonitorService } from '../src/maintenance/completion-reconciler-monitor.service.js';
const cfg = (): ConfigService => ({ get: vi.fn(), getOrThrow: vi.fn().mockReturnValue('scope') } as unknown as ConfigService);
const outbox = (): OutboxRelayService => ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService);
const proj = (): ProjectionRunnerService => ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService);
const gw = (): CommandsGateway => ({ reconcileNow: vi.fn().mockReturnValue([]) } as unknown as CommandsGateway);
describe('@fleet/api - SchedulerService completion-monitor tick', () => {
  beforeEach(() => { vi.useFakeTimers(); capturedTags.length = 0; });
  afterEach(() => { vi.useRealTimers(); });
  it('drainCompletionMonitor tags Sentry scope job=completion-monitor-check and calls checkOnce', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const mon = { checkOnce } as unknown as CompletionReconcilerMonitorService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), null, null, null, null, null, mon);
    await svc.drainCompletionMonitor();
    expect(checkOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('completion-monitor-check');
    svc.onModuleDestroy();
  });
  it('onModuleInit schedules the completion check at 300s when a monitor is present', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const mon = { checkOnce } as unknown as CompletionReconcilerMonitorService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), null, null, null, null, null, mon);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(checkOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(checkOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });
  it('keeps self-scheduling: a second completion tick fires another 300s later', async () => {
    const checkOnce = vi.fn().mockResolvedValue(undefined);
    const mon = { checkOnce } as unknown as CompletionReconcilerMonitorService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), null, null, null, null, null, mon);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(300_001);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(checkOnce).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });
  it('is dormant when no monitor is provided: checkOnce is never scheduled', async () => {
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw());
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(600_002);
    expect(capturedTags.find((t) => t.value === 'completion-monitor-check')).toBeUndefined();
    // Directly drive the drain with a null monitor to exercise the invokeDrain
    // null-guard false branch (the kind can be invoked but the dep is absent).
    await svc.drainCompletionMonitor();
    expect(capturedTags.find((t) => t.value === 'completion-monitor-check')).toBeDefined();
    svc.onModuleDestroy();
  });
});
