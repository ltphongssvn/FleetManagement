// apps/api/test/transport-orders.controller.test.ts
// Controller-only tests: Zod validation, seed-flag guard, service delegation.
// Service-level coverage moved to transport-orders.service.integration.test.ts.
//
// T3 (2026-Q2): the create endpoint must also drain the dispatch_board
// projection inline before returning, so the ops-web dispatcher's board
// reflects the new row immediately when the action settles. Mirrors the
// pattern used by TransportOrdersCancelController (T5).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransportOrdersController } from '../src/transport-orders/transport-orders.controller.js';
import type { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import { createOperatorContext } from '@fleet/test-fixtures';
const op: OperatorContext = createOperatorContext();
describe('@fleet/api - TransportOrdersController', () => {
  let create: ReturnType<typeof vi.fn>;
  let listAssigned: ReturnType<typeof vi.fn>;
  let tripHistory: ReturnType<typeof vi.fn>;
  let drainOnce: ReturnType<typeof vi.fn>;
  let svc: TransportOrdersService;
  let runner: { drainOnce: ReturnType<typeof vi.fn> };
  let ctl: TransportOrdersController;
  beforeEach(() => {
    create = vi.fn();
    listAssigned = vi.fn();
    tripHistory = vi.fn();
    drainOnce = vi.fn().mockResolvedValue({ scope: op.companyId, polled: 1, applied: 1, noops: 0, deletes: 0, newWatermark: '1' });
    svc = { create, listAssigned, tripHistory } as unknown as TransportOrdersService;
    runner = { drainOnce };
    ctl = new TransportOrdersController(svc, runner as never);
  });
  it('parses valid input and delegates to service', async () => {
    create.mockResolvedValue({ transportOrderId: 'to-1', roadRunId: 'rr-1' });
    const result = await ctl.create({
      externalRef: 'TO-1001',
      stops: [{ sequence: 1, stopType: 'pickup' }, { sequence: 2, stopType: 'dropoff' }],
      roadRun: {
        assignedOperatorId: '00000000-0000-0000-0000-0000000000a1',
        assignedAssetId: '00000000-0000-0000-0000-0000000000b2',
      },
    }, op);
    expect(result).toEqual({ transportOrderId: 'to-1', roadRunId: 'rr-1' });
    expect(create).toHaveBeenCalledOnce();
  });
  it('rejects invalid input via Zod', async () => {
    await expect(ctl.create({ stops: [] }, op)).rejects.toThrow();
  });
  it('rejects when seed flag disabled', async () => {
    process.env['FLEET_PILOT_SEED_ENABLED'] = 'false';
    await expect(ctl.create({ stops: [{ sequence: 1, stopType: 'pickup' }] }, op))
      .rejects.toThrow(/seed/i);
    delete process.env['FLEET_PILOT_SEED_ENABLED'];
  });
  it('listAssigned delegates to the service with the operator context', async () => {
    listAssigned.mockResolvedValue({ rows: [] });
    const result = await ctl.listAssigned(op);
    expect(result).toEqual({ rows: [] });
    expect(listAssigned).toHaveBeenCalledWith(op);
  });
  it('tripHistory delegates to the service with the operator context', async () => {
    const months = [{ monthKey: '2026-03', label: 'Thg 3 2026', count: 1, trips: [] }];
    tripHistory.mockResolvedValue({ months });
    const result = await ctl.tripHistory(op);
    expect(result).toEqual({ months });
    expect(tripHistory).toHaveBeenCalledWith(op);
  });
  it('drains the projection runner for the caller company after a successful create so the dispatch board reflects the new row before the response returns', async () => {
    create.mockResolvedValue({ transportOrderId: 'to-1', roadRunId: 'rr-1', externalRef: 'XTT.05-001' });
    await ctl.create({
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: {
        assignedOperatorId: '00000000-0000-0000-0000-0000000000a1',
        assignedAssetId: '00000000-0000-0000-0000-0000000000b2',
      },
    }, op);
    expect(drainOnce).toHaveBeenCalledWith(op.companyId);
  });
  it('does NOT drain the projection runner when create throws (no state to project)', async () => {
    create.mockRejectedValue(new Error('boom'));
    await expect(ctl.create({
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: {
        assignedOperatorId: '00000000-0000-0000-0000-0000000000a1',
        assignedAssetId: '00000000-0000-0000-0000-0000000000b2',
      },
    }, op)).rejects.toThrow('boom');
    expect(drainOnce).not.toHaveBeenCalled();
  });
});
