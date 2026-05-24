// apps/api/test/transport-orders.review.controller.find-by-ref.test.ts
// L4 RED for T5: the review controller GET /transport-orders/:id must
// accept BOTH a UUID and an XT.NNN external_ref. Dispatch board rows now
// link by external_ref, so the review endpoint that the page calls must
// resolve either form. The controller delegates to
// TransportOrdersService.findByCompanyIdOrRef (company-scoped, single-
// company deployment).
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ZodError } from 'zod';
import { TransportOrdersReviewController } from '../src/transport-orders/transport-orders.review.controller.js';
import { TransportOrderNotFoundError } from '../src/transport-orders/transport-orders.errors.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import type { ListAssignedRow } from '../src/transport-orders/transport-orders.dto.js';
const sampleRow: ListAssignedRow = {
  transportOrderId: '11111111-1111-1111-1111-111111111111',
  externalRef: 'XT.001',
  orderRef: 'XT.001',
  roadRunId: 'rr-1',
  state: 'planned',
  plannedStartAt: null,
  startedAt: null,
  completedAt: null,
  plate: null,
  customerName: null,
  pickupName: null,
  deliveryName: null,
  stops: [],
};
describe('@fleet/api - TransportOrdersReviewController.findOne (T5 ref-or-id)', () => {
  it('passes a UUID through to findByCompanyIdOrRef', async () => {
    const op = createOperatorContext();
    const svc = { findByCompanyIdOrRef: vi.fn().mockResolvedValue(sampleRow) };
    const ctl = new TransportOrdersReviewController(svc as never);
    const result = await ctl.findOne('11111111-1111-1111-1111-111111111111', op);
    expect(result).toBe(sampleRow);
    expect(svc.findByCompanyIdOrRef).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', op);
  });
  it('passes an XT.NNN external_ref through to findByCompanyIdOrRef', async () => {
    const op = createOperatorContext();
    const svc = { findByCompanyIdOrRef: vi.fn().mockResolvedValue(sampleRow) };
    const ctl = new TransportOrdersReviewController(svc as never);
    const result = await ctl.findOne('XT.001', op);
    expect(result).toBe(sampleRow);
    expect(svc.findByCompanyIdOrRef).toHaveBeenCalledWith('XT.001', op);
  });
  it('rejects a garbage param that is neither a UUID nor an XT.NNN ref', async () => {
    const op = createOperatorContext();
    const svc = { findByCompanyIdOrRef: vi.fn() };
    const ctl = new TransportOrdersReviewController(svc as never);
    await expect(ctl.findOne('not-an-id-and-not-a-ref', op))
      .rejects.toBeInstanceOf(ZodError);
    expect(svc.findByCompanyIdOrRef).not.toHaveBeenCalled();
  });
  it('translates TransportOrderNotFoundError into NotFoundException', async () => {
    const op = createOperatorContext();
    const svc = { findByCompanyIdOrRef: vi.fn().mockRejectedValue(new TransportOrderNotFoundError()) };
    const ctl = new TransportOrdersReviewController(svc as never);
    await expect(ctl.findOne('11111111-1111-1111-1111-111111111111', op))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
