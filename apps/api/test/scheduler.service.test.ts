// apps/api/test/scheduler.service.test.ts
// Core-tick behaviour of SchedulerService against the multi-provider registry:
// the three always-on ticks (outbox / projection / reconciler) are built by
// coreTickers() exactly as the module factory builds them, and the service
// drives them generically. Covers drainByKey, self-scheduling, and error
// isolation. The old exhaustiveness-guard tests (scheduleNext/tagFor/labelFor/
// invokeDrain default arms) are GONE: those switch statements no longer exist
// -- the registry replaced them, so there is no default arm to guard. The
// registry test covers the replacement invariant (unknown key -> no-op).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { SchedulerService } from '../src/scheduler/scheduler.service.js';
import { coreTickers } from './helpers/scheduler-ticker-factory.js';
import type { OutboxRelayService } from '../src/outbox/outbox-relay.service.js';
import type { ProjectionRunnerService } from '../src/projections/projection-runner.service.js';
import type { CommandsGateway } from '../src/commands/commands.gateway.js';

// Build the service around real core tickers wired to the given mocks, exactly
// as scheduler.module.ts assembles them (projection gets the pilot scope).
function makeSvc(deps: {
  outbox: OutboxRelayService;
  proj: ProjectionRunnerService;
  gw: CommandsGateway;
  scope?: string;
}): SchedulerService {
  const scope = deps.scope ?? 'pilot-scope-uuid';
  return new SchedulerService(
    coreTickers({
      outbox: () => deps.outbox.drainOnce(),
      projection: () => deps.proj.drainOnce(scope),
      reconciler: () => deps.gw.reconcileNow(),
    }),
  );
}

describe('SchedulerService (registry core ticks)', () => {
  let logErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    logErr = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    logErr.mockRestore();
  });

  it('drainByKey(outbox) calls outboxRelay.drainOnce', async () => {
    const drainOnce = vi.fn().mockResolvedValue(undefined);
    const svc = makeSvc({
      outbox: { drainOnce } as unknown as OutboxRelayService,
      proj: { drainOnce: vi.fn() } as unknown as ProjectionRunnerService,
      gw: { reconcileNow: () => [] } as unknown as CommandsGateway,
    });
    await svc.drainByKey('outbox');
    expect(drainOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('drainByKey(projection) calls projectionRunner.drainOnce with pilot scope', async () => {
    const drainProjFn = vi.fn().mockResolvedValue(undefined);
    const svc = makeSvc({
      outbox: { drainOnce: vi.fn() } as unknown as OutboxRelayService,
      proj: { drainOnce: drainProjFn } as unknown as ProjectionRunnerService,
      gw: { reconcileNow: () => [] } as unknown as CommandsGateway,
      scope: 'scope-x',
    });
    await svc.drainByKey('projection');
    expect(drainProjFn).toHaveBeenCalledWith('scope-x');
    svc.onModuleDestroy();
  });

  it('drainByKey(outbox) swallows errors and logs them (#615)', async () => {
    const svc = makeSvc({
      outbox: {
        drainOnce: vi.fn().mockRejectedValue(new Error('redis down')),
      } as unknown as OutboxRelayService,
      proj: { drainOnce: vi.fn() } as unknown as ProjectionRunnerService,
      gw: { reconcileNow: () => [] } as unknown as CommandsGateway,
    });
    await svc.drainByKey('outbox');
    expect(logErr).toHaveBeenCalledWith(expect.stringContaining('redis down'), expect.any(String));
    svc.onModuleDestroy();
  });

  it('drainByKey(projection) swallows errors and logs', async () => {
    const svc = makeSvc({
      outbox: { drainOnce: vi.fn() } as unknown as OutboxRelayService,
      proj: {
        drainOnce: vi.fn().mockRejectedValue(new Error('db locked')),
      } as unknown as ProjectionRunnerService,
      gw: { reconcileNow: () => [] } as unknown as CommandsGateway,
    });
    await svc.drainByKey('projection');
    expect(logErr).toHaveBeenCalledWith(expect.stringContaining('db locked'), expect.any(String));
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules first tick; onModuleDestroy cancels (no overlap)', () => {
    const drainOnce = vi.fn().mockResolvedValue(undefined);
    const svc = makeSvc({
      outbox: { drainOnce } as unknown as OutboxRelayService,
      proj: {
        drainOnce: vi.fn().mockResolvedValue(undefined),
      } as unknown as ProjectionRunnerService,
      gw: { reconcileNow: () => [] } as unknown as CommandsGateway,
    });
    svc.onModuleInit();
    expect(drainOnce).not.toHaveBeenCalled();
    svc.onModuleDestroy();
    vi.advanceTimersByTime(60_000);
    expect(drainOnce).not.toHaveBeenCalled();
  });

  it('onModuleInit fires the outbox tick after 5s', async () => {
    const drainOnce = vi.fn().mockResolvedValue(undefined);
    const svc = makeSvc({
      outbox: { drainOnce } as unknown as OutboxRelayService,
      proj: {
        drainOnce: vi.fn().mockResolvedValue(undefined),
      } as unknown as ProjectionRunnerService,
      gw: { reconcileNow: () => [] } as unknown as CommandsGateway,
    });
    svc.onModuleInit();
    expect(drainOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(drainOnce).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('drainByKey(outbox) swallows non-Error thrown values (#661)', async () => {
    const svc = makeSvc({
      outbox: {
        drainOnce: vi.fn().mockRejectedValue('redis exploded'),
      } as unknown as OutboxRelayService,
      proj: { drainOnce: vi.fn() } as unknown as ProjectionRunnerService,
      gw: { reconcileNow: () => [] } as unknown as CommandsGateway,
    });
    await svc.drainByKey('outbox');
    expect(logErr).toHaveBeenCalledWith(expect.stringContaining('redis exploded'));
    svc.onModuleDestroy();
  });

  it('drainByKey(reconciler) invokes commandsGateway.reconcileNow', async () => {
    const reconcileNow = vi.fn().mockReturnValue([]);
    const svc = makeSvc({
      outbox: { drainOnce: vi.fn() } as unknown as OutboxRelayService,
      proj: { drainOnce: vi.fn() } as unknown as ProjectionRunnerService,
      gw: { reconcileNow } as unknown as CommandsGateway,
    });
    await svc.drainByKey('reconciler');
    expect(reconcileNow).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('drainByKey(reconciler) swallows and logs reconcileNow errors', async () => {
    const reconcileNow = vi.fn(() => {
      throw new Error('reconcile boom');
    });
    const svc = makeSvc({
      outbox: { drainOnce: vi.fn() } as unknown as OutboxRelayService,
      proj: { drainOnce: vi.fn() } as unknown as ProjectionRunnerService,
      gw: { reconcileNow } as unknown as CommandsGateway,
    });
    await svc.drainByKey('reconciler');
    expect(logErr).toHaveBeenCalledWith(
      expect.stringContaining('reconcile boom'),
      expect.any(String),
    );
    svc.onModuleDestroy();
  });

  it('onModuleInit fires the reconciler tick after 2s', async () => {
    const reconcileNow = vi.fn().mockReturnValue([]);
    const svc = makeSvc({
      outbox: { drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService,
      proj: {
        drainOnce: vi.fn().mockResolvedValue(undefined),
      } as unknown as ProjectionRunnerService,
      gw: { reconcileNow } as unknown as CommandsGateway,
    });
    svc.onModuleInit();
    expect(reconcileNow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reconcileNow).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('drainByKey ignores an unknown key (registry replacement for the old default arms)', async () => {
    const svc = makeSvc({
      outbox: { drainOnce: vi.fn() } as unknown as OutboxRelayService,
      proj: { drainOnce: vi.fn() } as unknown as ProjectionRunnerService,
      gw: { reconcileNow: () => [] } as unknown as CommandsGateway,
    });
    await expect(svc.drainByKey('bogus')).resolves.toBeUndefined();
    svc.onModuleDestroy();
  });
});
