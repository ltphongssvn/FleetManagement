// apps/api/test/transport-orders.cancel.controller.test.ts
// L4 RED for T5: POST /transport-orders/:id/cancel endpoint.
// Mirrors the review-controller test shape exactly so future readers
// recognize the pattern: vi.fn() service, Zod-validated path + body,
// domain-error -> HTTP-exception translation.
//
// HTTP boundary contract:
//   path :id     -> Zod uuid, otherwise throws (NestJS returns 400)
//   body         -> CancelOrderInputSchema; missing reason -> throws (400)
//   200 on success (idempotent or fresh cancel)
//   404 on TransportOrderNotFoundError
//   409 on TransportOrderCannotBeCancelledError
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TransportOrdersCancelController } from '../src/transport-orders/transport-orders.cancel.controller.js';
import type { TransportOrdersCancelService } from '../src/transport-orders/transport-orders.cancel.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import {
  TransportOrderCannotBeCancelledError,
  TransportOrderNotFoundError,
} from '../src/transport-orders/transport-orders.errors.js';
const op: OperatorContext = createOperatorContext();
const validId = '11111111-1111-4111-8111-111111111111';
const validBody = { reason: 'customer_request', note: 'unit test' };
describe('@fleet/api - TransportOrdersCancelController', () => {
  let cancel: ReturnType<typeof vi.fn>;
  let drainOnce: ReturnType<typeof vi.fn>;
  let svc: TransportOrdersCancelService;
  let runner: { drainOnce: ReturnType<typeof vi.fn> };
  let ctl: TransportOrdersCancelController;
  beforeEach(() => {
    cancel = vi.fn();
    drainOnce = vi.fn().mockResolvedValue({ scope: op.companyId, polled: 1, applied: 1, noops: 0, deletes: 0, newWatermark: '1' });
    svc = { cancel } as unknown as TransportOrdersCancelService;
    runner = { drainOnce };
    ctl = new TransportOrdersCancelController(svc, runner as never);
  });
  it('delegates to svc.cancel with parsed path id, parsed body, and the operator context', async () => {
    const out = {
      transportOrderId: validId,
      state: 'cancelled' as const,
      cancelledAt: '2026-05-23T12:00:00.000Z',
      cancelledBy: op.operatorId,
      cancellationReason: 'customer_request',
      cancellationNote: 'unit test',
      idempotent: false,
    };
    cancel.mockResolvedValue(out);
    const result = await ctl.cancel(validId, validBody, op);
    expect(result).toEqual(out);
    expect(cancel).toHaveBeenCalledWith(validId, { reason: 'customer_request', note: 'unit test' }, op);
  });
  it('rejects a non-uuid :id path param via Zod', async () => {
    await expect(ctl.cancel('not-a-uuid', validBody, op)).rejects.toThrow();
    expect(cancel).not.toHaveBeenCalled();
  });
  it('rejects a body whose reason is not in the allow-list via Zod', async () => {
    await expect(ctl.cancel(validId, { reason: 'unicorn_strike' }, op)).rejects.toThrow();
    expect(cancel).not.toHaveBeenCalled();
  });
  it('rejects a body with no reason via Zod', async () => {
    await expect(ctl.cancel(validId, {}, op)).rejects.toThrow();
    expect(cancel).not.toHaveBeenCalled();
  });
  it('translates TransportOrderNotFoundError into NotFoundException (404)', async () => {
    cancel.mockRejectedValue(new TransportOrderNotFoundError());
    await expect(ctl.cancel(validId, validBody, op)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('translates TransportOrderCannotBeCancelledError into ConflictException (409)', async () => {
    cancel.mockRejectedValue(new TransportOrderCannotBeCancelledError('completed'));
    await expect(ctl.cancel(validId, validBody, op)).rejects.toBeInstanceOf(ConflictException);
  });
  it('propagates unrelated errors unchanged (500 at framework level)', async () => {
    const boom = new Error('boom');
    cancel.mockRejectedValue(boom);
    await expect(ctl.cancel(validId, validBody, op)).rejects.toBe(boom);
  });
  it('drains the projection runner for the caller company after a successful cancel so the dispatch board reflects the new state before the response returns', async () => {
    const out = {
      transportOrderId: validId,
      state: 'cancelled' as const,
      cancelledAt: '2026-05-23T12:00:00.000Z',
      cancelledBy: op.operatorId,
      cancellationReason: 'customer_request',
      cancellationNote: null,
      idempotent: false,
    };
    cancel.mockResolvedValue(out);
    await ctl.cancel(validId, validBody, op);
    expect(drainOnce).toHaveBeenCalledWith(op.companyId);
  });
  it('does NOT drain the projection runner when the cancel throws (no state change to publish)', async () => {
    cancel.mockRejectedValue(new TransportOrderNotFoundError());
    await expect(ctl.cancel(validId, validBody, op)).rejects.toBeInstanceOf(NotFoundException);
    expect(drainOnce).not.toHaveBeenCalled();
  });
});
