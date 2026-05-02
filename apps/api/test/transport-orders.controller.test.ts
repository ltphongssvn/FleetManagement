// apps/api/test/transport-orders.controller.test.ts
// Controller-only tests: Zod validation, seed-flag guard, service delegation.
// Service-level coverage moved to transport-orders.service.integration.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransportOrdersController } from '../src/transport-orders/transport-orders.controller.js';
import type { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import { createOperatorContext } from '@fleet/test-fixtures';

const op: OperatorContext = createOperatorContext();

describe('@fleet/api - TransportOrdersController', () => {
  let create: ReturnType<typeof vi.fn>;
  let svc: TransportOrdersService;
  let ctl: TransportOrdersController;

  beforeEach(() => {
    create = vi.fn();
    svc = { create } as unknown as TransportOrdersService;
    ctl = new TransportOrdersController(svc);
  });

  it('parses valid input and delegates to service', async () => {
    create.mockResolvedValue({ transportOrderId: 'to-1', roadRunId: 'rr-1' });
    const result = await ctl.create({
      externalRef: 'TO-1001',
      stops: [{ sequence: 1, stopType: 'pickup' }, { sequence: 2, stopType: 'dropoff' }],
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
});
