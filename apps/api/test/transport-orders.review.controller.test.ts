// apps/api/test/transport-orders.review.controller.test.ts
// RED: new GET /transport-orders/:id endpoint for the dispatcher review view.
// Verifies (1) the controller delegates to svc.findById with the calling
// operator context, (2) Zod-validates the :id path param as a UUID,
// (3) propagates NotFoundException when the service signals no such order
// in the calling tenancy.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TransportOrdersReviewController } from '../src/transport-orders/transport-orders.review.controller.js';
import type { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import { TransportOrderNotFoundError } from '../src/transport-orders/transport-orders.errors.js';
const op: OperatorContext = createOperatorContext();
describe('@fleet/api - TransportOrdersReviewController', () => {
  let findById: ReturnType<typeof vi.fn>;
  let svc: TransportOrdersService;
  let ctl: TransportOrdersReviewController;
  beforeEach(() => {
    findById = vi.fn();
    svc = { findById } as unknown as TransportOrdersService;
    ctl = new TransportOrdersReviewController(svc);
  });
  it('delegates to svc.findById with the operator context for a valid uuid', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const row = { transportOrderId: id, externalRef: 'TO-1', roadRunId: 'rr-1', state: 'planned', plannedStartAt: null, startedAt: null, completedAt: null, orderRef: 'TO-1', plate: '51A-123', customerName: 'Acme', pickupName: 'WH1', deliveryName: 'WH2', stops: [] };
    findById.mockResolvedValue(row);
    const result = await ctl.findOne(id, op);
    expect(result).toEqual(row);
    expect(findById).toHaveBeenCalledWith(id, op);
  });
  it('rejects a non-uuid :id path param via Zod', async () => {
    await expect(ctl.findOne('not-a-uuid', op)).rejects.toThrow();
  });
  it('translates TransportOrderNotFoundError into NotFoundException', async () => {
    findById.mockRejectedValue(new TransportOrderNotFoundError());
    await expect(
      ctl.findOne('22222222-2222-2222-2222-222222222222', op),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
