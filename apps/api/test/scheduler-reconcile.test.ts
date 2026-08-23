// apps/api/test/scheduler-reconcile.test.ts
// SchedulerService drives CommandsGateway.reconcileNow via its reconciler core
// tick, re-expressed against the multi-provider registry: the reconciler is one
// of the three core tickers (coreTickers), driven generically by drainByKey.
import { describe, it, expect, vi } from 'vitest';
import { SchedulerService } from '../src/scheduler/scheduler.service.js';
import { coreTickers } from './helpers/scheduler-ticker-factory.js';
import type { CommandsGateway } from '../src/commands/commands.gateway.js';

function makeSvc(gateway: CommandsGateway): SchedulerService {
  return new SchedulerService(
    coreTickers({
      outbox: () => undefined,
      projection: () => undefined,
      reconciler: () => gateway.reconcileNow(),
    }),
  );
}

describe('@fleet/api - SchedulerService drives CommandsGateway reconciler', () => {
  it('invokes gateway.reconcileNow() on its own tick', async () => {
    const reconcileNow = vi.fn().mockReturnValue([]);
    const svc = makeSvc({ reconcileNow } as unknown as CommandsGateway);
    await svc.drainByKey('reconciler');
    expect(reconcileNow).toHaveBeenCalledOnce();
    svc.onModuleDestroy();
  });

  it('continues (does not reject) even if gateway.reconcileNow throws', async () => {
    const reconcileNow = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    const svc = makeSvc({ reconcileNow } as unknown as CommandsGateway);
    await expect(svc.drainByKey('reconciler')).resolves.toBeUndefined();
    svc.onModuleDestroy();
  });
});
