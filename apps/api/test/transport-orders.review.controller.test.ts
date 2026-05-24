// apps/api/test/transport-orders.review.controller.test.ts
// L4 unit tests for the dispatcher review controller. T5 (2026): the
// service method changed from findById (operator-scoped) to
// findByCompanyIdOrRef (company-scoped + accepts UUID or XT.NNN ref);
// these tests cover the controller-shape behavior: delegation, Zod
// validation, and NotFoundException translation. Ref-or-id parsing
// branches are covered by transport-orders.review.controller.find-by-ref.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TransportOrdersReviewController } from '../src/transport-orders/transport-orders.review.controller.js';
import type { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import { TransportOrderNotFoundError } from '../src/transport-orders/transport-orders.errors.js';
const op: OperatorContext = createOperatorContext();
describe('@fleet/api - TransportOrdersReviewController', () => {
  let findByCompanyIdOrRef: ReturnType<typeof vi.fn>;
  let svc: TransportOrdersService;
  let ctl: TransportOrdersReviewController;
  beforeEach(() => {
    findByCompanyIdOrRef = vi.fn();
    svc = { findByCompanyIdOrRef } as unknown as TransportOrdersService;
    ctl = new TransportOrdersReviewController(svc);
  });
  it('delegates to svc.findByCompanyIdOrRef with the operator context for a valid uuid', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const row = { transportOrderId: id, externalRef: 'TO-1', roadRunId: 'rr-1', state: 'planned', plannedStartAt: null, startedAt: null, completedAt: null, orderRef: 'TO-1', plate: '51A-123', customerName: 'Acme', pickupName: 'WH1', deliveryName: 'WH2', stops: [] };
    findByCompanyIdOrRef.mockResolvedValue(row);
    const result = await ctl.findOne(id, op);
    expect(result).toEqual(row);
    expect(findByCompanyIdOrRef).toHaveBeenCalledWith(id, op);
  });
  it('rejects a :id path param that is neither a UUID nor an XT.NNN ref via Zod', async () => {
    await expect(ctl.findOne('not-an-id-and-not-a-ref', op)).rejects.toThrow();
  });
  it('translates TransportOrderNotFoundError into NotFoundException', async () => {
    findByCompanyIdOrRef.mockRejectedValue(new TransportOrderNotFoundError());
    await expect(
      ctl.findOne('22222222-2222-2222-2222-222222222222', op),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
