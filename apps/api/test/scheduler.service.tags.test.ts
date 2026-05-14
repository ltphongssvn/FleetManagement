// apps/api/test/scheduler.service.tags.test.ts
// Unit tests pinning Sentry tag values per kind, error label prefixes,
// reconciler interval, and timer-routing per kind. Kills remaining
// scheduler.service.ts Stryker mutants on the ternary StringLiterals.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

const { mockWithIsolationScope, mockCaptureException, capturedTags } = vi.hoisted(() => {
  const capturedTags: { key: string; value: unknown }[] = [];
  return {
    capturedTags,
    mockCaptureException: vi.fn(),
    mockWithIsolationScope: vi.fn(async (fn: (scope: { setTag: (k: string, v: unknown) => void }) => Promise<void>) => {
      const scope = {
        setTag: (k: string, v: unknown) => {
          capturedTags.push({ key: k, value: v });
        },
      };
      await fn(scope);
    }),
  };
});

vi.mock('@sentry/nestjs', () => ({
  withIsolationScope: mockWithIsolationScope,
  captureException: mockCaptureException,
}));

import { SchedulerService } from '../src/scheduler/scheduler.service.js';
import type { OutboxRelayService } from '../src/outbox/outbox-relay.service.js';
import type { ProjectionRunnerService } from '../src/projections/projection-runner.service.js';
import type { CommandsGateway } from '../src/commands/commands.gateway.js';

function makeConfig(scope = 'pilot-scope-uuid'): ConfigService {
  return {
    get: vi.fn().mockReturnValue(scope),
    getOrThrow: vi.fn().mockReturnValue(scope),
  } as unknown as ConfigService;
}

describe('@fleet/api - SchedulerService tags & labels', () => {
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

  it('drainOutbox tags Sentry scope with job=outbox-drain (kills tag StringLiteral)', async () => {
    const outbox = { drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn() } as unknown as ProjectionRunnerService;
    const gw = { reconcileNow: () => [] } as unknown as CommandsGateway;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never, gw);
    await svc.drainOutbox();
    const jobTag = capturedTags.find((t) => t.key === 'job');
    expect(jobTag?.value).toBe('outbox-drain');
    svc.onModuleDestroy();
  });

  it('drainProjections tags Sentry scope with job=projection-drain (kills tag StringLiteral)', async () => {
    const outbox = { drainOnce: vi.fn() } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService;
    const gw = { reconcileNow: () => [] } as unknown as CommandsGateway;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never, gw);
    await svc.drainProjections();
    const jobTag = capturedTags.find((t) => t.key === 'job');
    expect(jobTag?.value).toBe('projection-drain');
    svc.onModuleDestroy();
  });

  it('drainReconciler tags Sentry scope with job=commands-reconciler (kills tag StringLiteral)', async () => {
    const outbox = { drainOnce: vi.fn() } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn() } as unknown as ProjectionRunnerService;
    const gw = { reconcileNow: vi.fn().mockReturnValue([]) } as unknown as CommandsGateway;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never, gw);
    await svc.drainReconciler();
    const jobTag = capturedTags.find((t) => t.key === 'job');
    expect(jobTag?.value).toBe('commands-reconciler');
    svc.onModuleDestroy();
  });

  it('uses the key string "job" when calling setTag (kills "job" StringLiteral)', async () => {
    const outbox = { drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn() } as unknown as ProjectionRunnerService;
    const gw = { reconcileNow: () => [] } as unknown as CommandsGateway;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never, gw);
    await svc.drainOutbox();
    expect(capturedTags[0]?.key).toBe('job');
    svc.onModuleDestroy();
  });

  it('reads FLEET_PILOT_SCOPE env via ConfigService (kills key StringLiteral)', () => {
    const getOrThrowMock = vi.fn().mockReturnValue('scope-y');
    const cfg = { get: vi.fn(), getOrThrow: getOrThrowMock } as unknown as ConfigService;
    const outbox = { drainOnce: vi.fn() } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn() } as unknown as ProjectionRunnerService;
    const gw = { reconcileNow: () => [] } as unknown as CommandsGateway;
    new SchedulerService(outbox, proj, cfg as never, gw);
    expect(getOrThrowMock).toHaveBeenCalledWith('FLEET_PILOT_SCOPE', { infer: true });
  });

  it('drainOutbox error log uses "Outbox drain failed: " prefix (kills label StringLiteral)', async () => {
    const outbox = { drainOnce: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn() } as unknown as ProjectionRunnerService;
    const gw = { reconcileNow: () => [] } as unknown as CommandsGateway;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never, gw);
    await svc.drainOutbox();
    expect(logErr).toHaveBeenCalledWith(expect.stringMatching(/^Outbox drain failed: /), expect.any(String));
    svc.onModuleDestroy();
  });

  it('drainProjections error log uses "Projection drain failed: " prefix (kills label StringLiteral)', async () => {
    const outbox = { drainOnce: vi.fn() } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn().mockRejectedValue(new Error('db locked')) } as unknown as ProjectionRunnerService;
    const gw = { reconcileNow: () => [] } as unknown as CommandsGateway;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never, gw);
    await svc.drainProjections();
    expect(logErr).toHaveBeenCalledWith(expect.stringMatching(/^Projection drain failed: /), expect.any(String));
    svc.onModuleDestroy();
  });

  it('drainReconciler error log uses "Reconciler tick failed: " prefix (kills label StringLiteral)', async () => {
    const outbox = { drainOnce: vi.fn() } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn() } as unknown as ProjectionRunnerService;
    const gw = {
      reconcileNow: vi.fn().mockImplementation(() => {
        throw new Error('rec boom');
      }),
    } as unknown as CommandsGateway;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never, gw);
    await svc.drainReconciler();
    expect(logErr).toHaveBeenCalledWith(expect.stringMatching(/^Reconciler tick failed: /), expect.any(String));
    svc.onModuleDestroy();
  });

  it('calls Sentry.captureException on error (kills withIsolationScope catch BlockStatement)', async () => {
    const err = new Error('captured');
    const outbox = { drainOnce: vi.fn().mockRejectedValue(err) } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn() } as unknown as ProjectionRunnerService;
    const gw = { reconcileNow: () => [] } as unknown as CommandsGateway;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never, gw);
    await svc.drainOutbox();
    expect(mockCaptureException).toHaveBeenCalledWith(err);
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules reconciler with 2s interval (kills RECONCILE_INTERVAL_MS literal)', async () => {
    const outbox = { drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService;
    const recFn = vi.fn().mockReturnValue([]);
    const gw = { reconcileNow: recFn } as unknown as CommandsGateway;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never, gw);
    svc.onModuleInit();
    // Before 2s reconciler should NOT have fired
    await vi.advanceTimersByTimeAsync(1_999);
    expect(recFn).not.toHaveBeenCalled();
    // After 2s reconciler fires
    await vi.advanceTimersByTimeAsync(2);
    expect(recFn).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });

  it('onModuleInit schedules outbox + projection with 5s interval, reconciler with 2s (kills DRAIN_INTERVAL_MS literal)', async () => {
    const outboxFn = vi.fn().mockResolvedValue(undefined);
    const projFn = vi.fn().mockResolvedValue(undefined);
    const recFn = vi.fn().mockReturnValue([]);
    const outbox = { drainOnce: outboxFn } as unknown as OutboxRelayService;
    const proj = { drainOnce: projFn } as unknown as ProjectionRunnerService;
    const gw = { reconcileNow: recFn } as unknown as CommandsGateway;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never, gw);
    svc.onModuleInit();
    // At 2.001s: only reconciler has fired
    await vi.advanceTimersByTimeAsync(2_001);
    expect(recFn).toHaveBeenCalledTimes(1);
    expect(outboxFn).not.toHaveBeenCalled();
    expect(projFn).not.toHaveBeenCalled();
    // At 5.001s total: outbox + projection have fired once each
    await vi.advanceTimersByTimeAsync(3_000);
    expect(outboxFn).toHaveBeenCalledTimes(1);
    expect(projFn).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
  });
});
