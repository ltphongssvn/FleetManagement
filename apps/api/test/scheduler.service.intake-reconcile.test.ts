// apps/api/test/scheduler.service.intake-reconcile.test.ts
// TDD for the intake self-healing reconciler tick wired into
// SchedulerService (T9 arc): an optional 7th monitor dependency, an
// intakeReconcile self-scheduling kind at 300s inside a tagged Sentry
// isolation scope. Mirrors scheduler.service.intake-lag.test.ts exactly.
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
import type { IntakeReconcilerService } from '../src/manifest/intake-reconciler.service.js';
const cfg = (): ConfigService => ({ get: vi.fn(), getOrThrow: vi.fn().mockReturnValue('scope') } as unknown as ConfigService);
const outbox = (): OutboxRelayService => ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService);
const proj = (): ProjectionRunnerService => ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService);
const gw = (): CommandsGateway => ({ reconcileNow: vi.fn().mockReturnValue([]) } as unknown as CommandsGateway);
const RESULT = { eligible: 0, emitted: 0, exhausted: 0 };
describe('@fleet/api - SchedulerService intake-reconcile tick', () => {
  beforeEach(() => { vi.useFakeTimers(); capturedTags.length = 0; });
  afterEach(() => { vi.useRealTimers(); });
  it('drainIntakeReconcile tags Sentry scope job=intake-reconcile and calls reconcileOnce', async () => {
    const reconcileOnce = vi.fn().mockResolvedValue(RESULT);
    const svc_ = { reconcileOnce } as unknown as IntakeReconcilerService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), null, null, svc_);
    await svc.drainIntakeReconcile();
    expect(reconcileOnce).toHaveBeenCalledTimes(1);
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('intake-reconcile');
    svc.onModuleDestroy();
  });
  it('onModuleInit schedules the reconcile at 300s when a reconciler is present', async () => {
    const reconcileOnce = vi.fn().mockResolvedValue(RESULT);
    const svc_ = { reconcileOnce } as unknown as IntakeReconcilerService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), null, null, svc_);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(reconcileOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(reconcileOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });
  it('keeps self-scheduling: a second tick fires another 300s later', async () => {
    const reconcileOnce = vi.fn().mockResolvedValue(RESULT);
    const svc_ = { reconcileOnce } as unknown as IntakeReconcilerService;
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw(), null, null, svc_);
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(300_001);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(reconcileOnce).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });
  it('is dormant when no reconciler is provided: reconcileOnce is never called', async () => {
    const svc = new SchedulerService(outbox(), proj(), cfg() as never, gw());
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(600_002);
    // No reconciler injected -> the intakeReconcile kind is never scheduled.
    expect(capturedTags.find((t) => t.value === 'intake-reconcile')).toBeUndefined();
    // Directly drive the drain with a null reconciler to exercise invokeDrain
    // null-guard false branch (the kind can be invoked but the dep is absent).
    await svc.drainIntakeReconcile();
    expect(capturedTags.find((t) => t.value === 'intake-reconcile')).toBeDefined();
    svc.onModuleDestroy();
  });
});
