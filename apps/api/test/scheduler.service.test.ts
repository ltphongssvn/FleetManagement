// apps/api/test/scheduler.service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SchedulerService } from '../src/scheduler/scheduler.service.js';
import type { OutboxRelayService } from '../src/outbox/outbox-relay.service.js';
import type { ProjectionRunnerService } from '../src/projections/projection-runner.service.js';

function makeConfig(scope = 'pilot-scope-uuid'): ConfigService {
  return { get: vi.fn().mockReturnValue(scope) } as unknown as ConfigService;
}

describe('SchedulerService', () => {
  let logErr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    logErr = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    logErr.mockRestore();
  });

  it('drainOutbox calls outboxRelay.drainOnce', async () => {
    const drainOutboxFn = vi.fn().mockResolvedValue(undefined);
    const outbox = { drainOnce: drainOutboxFn } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn() } as unknown as ProjectionRunnerService;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never);
    await svc.drainOutbox();
    expect(drainOutboxFn).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy.call(svc);
  });

  it('drainProjections calls projectionRunner.drainOnce with pilot scope', async () => {
    const outbox = { drainOnce: vi.fn() } as unknown as OutboxRelayService;
    const drainProjFn = vi.fn().mockResolvedValue(undefined);
    const proj = { drainOnce: drainProjFn } as unknown as ProjectionRunnerService;
    const svc = new SchedulerService(outbox, proj, makeConfig('scope-x') as never);
    await svc.drainProjections();
    expect(drainProjFn).toHaveBeenCalledWith('scope-x');
    svc.onModuleDestroy.call(svc);
  });

  it('drainOutbox swallows errors and logs them (#615)', async () => {
    const outbox = { drainOnce: vi.fn().mockRejectedValue(new Error('redis down')) } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn() } as unknown as ProjectionRunnerService;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never);
    await svc.drainOutbox();
    expect(logErr).toHaveBeenCalledWith(expect.stringContaining('redis down'));
    svc.onModuleDestroy.call(svc);
  });

  it('drainProjections swallows errors and logs', async () => {
    const outbox = { drainOnce: vi.fn() } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn().mockRejectedValue(new Error('db locked')) } as unknown as ProjectionRunnerService;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never);
    await svc.drainProjections();
    expect(logErr).toHaveBeenCalledWith(expect.stringContaining('db locked'));
    svc.onModuleDestroy.call(svc);
  });

  it('onModuleInit schedules first tick; onModuleDestroy cancels (#611 no overlap)', () => {
    const drainOutboxFn = vi.fn().mockResolvedValue(undefined);
    const outbox = { drainOnce: drainOutboxFn } as unknown as OutboxRelayService;
    const proj = { drainOnce: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService;
    const svc = new SchedulerService(outbox, proj, makeConfig() as never);
    svc.onModuleInit.call(svc);
    expect(drainOutboxFn).not.toHaveBeenCalled();
    svc.onModuleDestroy.call(svc);
    vi.advanceTimersByTime(60_000);
    expect(drainOutboxFn).not.toHaveBeenCalled();
  });
});
