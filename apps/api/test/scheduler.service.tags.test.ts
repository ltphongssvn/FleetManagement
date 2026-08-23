// apps/api/test/scheduler.service.tags.test.ts
// Mutation-hardening for SchedulerService core ticks against the multi-provider
// registry: pins Sentry job tags, error-label prefixes, tick intervals, timer
// clearing, and the stopped-guard for the three core tickers (outbox 5s /
// projection 5s / reconciler 2s). Tags + labels + intervals now live in the
// ticker VALUES (built by coreTickers, mirroring scheduler.module.ts); the
// service applies them generically. The old FLEET_PILOT_SCOPE-read test moved
// to the module factory; scope routing is still pinned via the projection tick.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
const { mockWithIsolationScope, mockCaptureException, capturedTags } = vi.hoisted(() => {
  const capturedTags: { key: string; value: unknown }[] = [];
  return {
    capturedTags,
    mockCaptureException: vi.fn(),
    mockWithIsolationScope: vi.fn(
      async (fn: (scope: { setTag: (k: string, v: unknown) => void }) => Promise<void>) => {
        await fn({
          setTag: (k: string, v: unknown) => {
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
import { coreTickers, INTERVALS } from './helpers/scheduler-ticker-factory.js';
import type { OutboxRelayService } from '../src/outbox/outbox-relay.service.js';
import type { ProjectionRunnerService } from '../src/projections/projection-runner.service.js';
import type { CommandsGateway } from '../src/commands/commands.gateway.js';

function makeSvc(deps: {
  outbox?: OutboxRelayService;
  proj?: ProjectionRunnerService;
  gw?: CommandsGateway;
  scope?: string;
}): SchedulerService {
  const outbox =
    deps.outbox ??
    ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService);
  const proj =
    deps.proj ??
    ({ drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService);
  const gw = deps.gw ?? ({ reconcileNow: () => [] } as unknown as CommandsGateway);
  const scope = deps.scope ?? 'pilot-scope-uuid';
  return new SchedulerService(
    coreTickers({
      outbox: () => outbox.drainOnce(),
      projection: () => proj.drainOnce(scope),
      reconciler: () => gw.reconcileNow(),
    }),
  );
}

describe('@fleet/api - SchedulerService tags & labels (registry)', () => {
  let logErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    capturedTags.length = 0;
    mockCaptureException.mockReset();
    mockWithIsolationScope.mockClear();
    logErr = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    logErr.mockRestore();
  });

  it('outbox tick tags job=outbox-drain', async () => {
    const svc = makeSvc({});
    await svc.drainByKey('outbox');
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('outbox-drain');
    svc.onModuleDestroy();
  });

  it('projection tick tags job=projection-drain', async () => {
    const svc = makeSvc({});
    await svc.drainByKey('projection');
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('projection-drain');
    svc.onModuleDestroy();
  });

  it('reconciler tick tags job=commands-reconciler', async () => {
    const svc = makeSvc({});
    await svc.drainByKey('reconciler');
    expect(capturedTags.find((t) => t.key === 'job')?.value).toBe('commands-reconciler');
    svc.onModuleDestroy();
  });

  it('uses the key string job when calling setTag', async () => {
    const svc = makeSvc({});
    await svc.drainByKey('outbox');
    expect(capturedTags[0]?.key).toBe('job');
    svc.onModuleDestroy();
  });

  it('projection tick passes the pilot scope through to drainOnce', async () => {
    const drainProjFn = vi.fn().mockResolvedValue(undefined);
    const svc = makeSvc({
      proj: { drainOnce: drainProjFn } as unknown as ProjectionRunnerService,
      scope: 'scope-y',
    });
    await svc.drainByKey('projection');
    expect(drainProjFn).toHaveBeenCalledWith('scope-y');
    svc.onModuleDestroy();
  });

  it('outbox error log uses Outbox drain failed prefix', async () => {
    const svc = makeSvc({
      outbox: {
        drainOnce: vi.fn().mockRejectedValue(new Error('boom')),
      } as unknown as OutboxRelayService,
    });
    await svc.drainByKey('outbox');
    expect(logErr).toHaveBeenCalledWith(
      expect.stringMatching(/^Outbox drain failed: /),
      expect.any(String),
    );
    svc.onModuleDestroy();
  });

  it('projection error log uses Projection drain failed prefix', async () => {
    const svc = makeSvc({
      proj: {
        drainOnce: vi.fn().mockRejectedValue(new Error('db locked')),
      } as unknown as ProjectionRunnerService,
    });
    await svc.drainByKey('projection');
    expect(logErr).toHaveBeenCalledWith(
      expect.stringMatching(/^Projection drain failed: /),
      expect.any(String),
    );
    svc.onModuleDestroy();
  });

  it('reconciler error log uses Reconciler tick failed prefix', async () => {
    const gw = {
      reconcileNow: vi.fn().mockImplementation(() => {
        throw new Error('rec boom');
      }),
    } as unknown as CommandsGateway;
    const svc = makeSvc({ gw });
    await svc.drainByKey('reconciler');
    expect(logErr).toHaveBeenCalledWith(
      expect.stringMatching(/^Reconciler tick failed: /),
      expect.any(String),
    );
    svc.onModuleDestroy();
  });

  it('calls Sentry.captureException on error', async () => {
    const err = new Error('captured');
    const svc = makeSvc({
      outbox: { drainOnce: vi.fn().mockRejectedValue(err) } as unknown as OutboxRelayService,
    });
    await svc.drainByKey('outbox');
    expect(mockCaptureException).toHaveBeenCalledWith(err);
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules reconciler at its 2s interval', async () => {
    const recFn = vi.fn().mockReturnValue([]);
    const svc = makeSvc({ gw: { reconcileNow: recFn } as unknown as CommandsGateway });
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.reconciler - 1);
    expect(recFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(recFn).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules outbox+projection at 5s, reconciler at 2s', async () => {
    const outboxFn = vi.fn().mockResolvedValue(undefined);
    const projFn = vi.fn().mockResolvedValue(undefined);
    const recFn = vi.fn().mockReturnValue([]);
    const svc = makeSvc({
      outbox: { drainOnce: outboxFn } as unknown as OutboxRelayService,
      proj: { drainOnce: projFn } as unknown as ProjectionRunnerService,
      gw: { reconcileNow: recFn } as unknown as CommandsGateway,
    });
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.reconciler + 1);
    expect(recFn).toHaveBeenCalledTimes(1);
    expect(outboxFn).not.toHaveBeenCalled();
    expect(projFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(outboxFn).toHaveBeenCalledTimes(1);
    expect(projFn).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('onModuleDestroy with no scheduled timers does not throw', () => {
    const svc = makeSvc({});
    expect(() => {
      svc.onModuleDestroy();
    }).not.toThrow();
  });

  it('onModuleDestroy stops re-arming: after destroy no tick fires', async () => {
    const outboxFn = vi.fn().mockResolvedValue(undefined);
    const svc = makeSvc({ outbox: { drainOnce: outboxFn } as unknown as OutboxRelayService });
    svc.onModuleInit();
    svc.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outboxFn).not.toHaveBeenCalled();
  });

  it('after a tick, the same ticker is rescheduled via finally', async () => {
    const outboxFn = vi.fn().mockResolvedValue(undefined);
    const svc = makeSvc({ outbox: { drainOnce: outboxFn } as unknown as OutboxRelayService });
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.outbox);
    expect(outboxFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVALS.outbox);
    expect(outboxFn).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });

  it('reconciler keeps re-scheduling after a thrown tick', async () => {
    const recFn = vi.fn().mockImplementation(() => {
      throw new Error('rec boom');
    });
    const svc = makeSvc({ gw: { reconcileNow: recFn } as unknown as CommandsGateway });
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.reconciler);
    expect(recFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVALS.reconciler);
    expect(recFn).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });

  it('after onModuleDestroy, drainByKey runs the body once but does not reschedule', async () => {
    const outboxFn = vi.fn().mockResolvedValue(undefined);
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const svc = makeSvc({ outbox: { drainOnce: outboxFn } as unknown as OutboxRelayService });
    svc.onModuleDestroy();
    setSpy.mockClear();
    await svc.drainByKey('outbox');
    expect(outboxFn).toHaveBeenCalledTimes(1);
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it('onModuleInit does not throw and arms one timer per ticker', () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const svc = makeSvc({});
    expect(() => {
      svc.onModuleInit();
    }).not.toThrow();
    expect(setSpy).toHaveBeenCalledTimes(3);
    setSpy.mockRestore();
    svc.onModuleDestroy();
  });

  it('onModuleDestroy clears every armed timer; re-destroy clears none', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const svc = makeSvc({});
    svc.onModuleInit();
    svc.onModuleDestroy();
    expect(clearSpy).toHaveBeenCalledTimes(3);
    clearSpy.mockClear();
    svc.onModuleDestroy();
    expect(clearSpy).toHaveBeenCalledTimes(0);
    clearSpy.mockRestore();
  });

  it('reconciler ticker fires at 2s, not 5s (interval routing)', async () => {
    const outboxFn = vi.fn().mockResolvedValue(undefined);
    const projFn = vi.fn().mockResolvedValue(undefined);
    const recFn = vi.fn().mockReturnValue([]);
    const svc = makeSvc({
      outbox: { drainOnce: outboxFn } as unknown as OutboxRelayService,
      proj: { drainOnce: projFn } as unknown as ProjectionRunnerService,
      gw: { reconcileNow: recFn } as unknown as CommandsGateway,
    });
    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVALS.reconciler);
    expect(recFn).toHaveBeenCalledTimes(1);
    expect(outboxFn).not.toHaveBeenCalled();
    expect(projFn).not.toHaveBeenCalled();
    svc.onModuleDestroy();
  });
});
