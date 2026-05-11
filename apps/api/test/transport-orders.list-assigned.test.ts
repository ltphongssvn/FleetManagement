// apps/api/test/transport-orders.list-assigned.test.ts
// RED: GET /transport-orders/assigned returns road runs assigned to current operator.
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransportOrdersController } from '../src/transport-orders/transport-orders.controller.js';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { JwtGuard } from '../src/auth/jwt.guard.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
describe('GET /transport-orders/assigned', () => {
  let controller: TransportOrdersController;
  const svc = {
    create: vi.fn(),
    listAssigned: vi.fn(),
  };
  beforeEach(async () => {
    svc.listAssigned.mockReset();
    const mod = await Test.createTestingModule({
      controllers: [TransportOrdersController],
      providers: [{ provide: TransportOrdersService, useValue: svc }],
    })
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(TransportOrdersController);
  });
  it('returns orders assigned to operator', async () => {
    const op: OperatorContext = {
      operatorId: '00000000-0000-0000-0000-000000000001',
      companyId: '00000000-0000-0000-0000-000000000000',
      businessUnitId: '00000000-0000-0000-0000-000000000000',
      depotId: '00000000-0000-0000-0000-000000000000',
      legalEntityId: '00000000-0000-0000-0000-000000000000',
      subject: 'driver1',
      issuedAt: 0,
      expiresAt: 0,
    };
    svc.listAssigned.mockResolvedValueOnce({ rows: [{ transportOrderId: 't1', externalRef: 'TO-1', roadRunId: 'r1', state: 'planned', stops: [] }] });
    const r = await controller.listAssigned(op);
    expect(svc.listAssigned).toHaveBeenCalledWith(op);
    expect(r).toEqual({ rows: [{ transportOrderId: 't1', externalRef: 'TO-1', roadRunId: 'r1', state: 'planned', stops: [] }] });
  });
});
