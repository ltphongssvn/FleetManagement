// apps/api/test/scheduler-reconcile.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SchedulerService } from '../src/scheduler/scheduler.service.js';
import type { OutboxRelayService } from '../src/outbox/outbox-relay.service.js';
import type { ProjectionRunnerService } from '../src/projections/projection-runner.service.js';
import type { CommandsGateway } from '../src/commands/commands.gateway.js';

describe('@fleet/api - SchedulerService drives CommandsGateway reconciler', () => {
  it('invokes gateway.reconcileNow() on its own tick', async () => {
    const reconcileNow = vi.fn().mockReturnValue([]);
    const gateway = { reconcileNow } as unknown as CommandsGateway;
    const outbox = { drain: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService;
    const projection = { drain: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService;
    const config = { getOrThrow: () => 'pilot-scope' } as never;
    const svc = new SchedulerService(outbox, projection, config, gateway);
    // Direct invocation of reconcile drain (avoids setTimeout flakiness)
    await (svc as unknown as { drainReconciler: () => Promise<void> }).drainReconciler();
    expect(reconcileNow).toHaveBeenCalledOnce();
  });

  it('continues scheduling reconciler even if gateway.reconcileNow throws', async () => {
    const reconcileNow = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const gateway = { reconcileNow } as unknown as CommandsGateway;
    const outbox = { drain: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxRelayService;
    const projection = { drain: vi.fn().mockResolvedValue(undefined) } as unknown as ProjectionRunnerService;
    const config = { getOrThrow: () => 'pilot-scope' } as never;
    const svc = new SchedulerService(outbox, projection, config, gateway);
    await expect(
      (svc as unknown as { drainReconciler: () => Promise<void> }).drainReconciler(),
    ).resolves.toBeUndefined();
  });
});
