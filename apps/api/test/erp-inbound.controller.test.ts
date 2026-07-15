// apps/api/test/erp-inbound.controller.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErpInboundController } from '../src/erp-inbound/erp-inbound.controller.js';
import type { ErpInboundService } from '../src/erp-inbound/erp-inbound.service.js';
import type { ConfigService } from '@nestjs/config';

describe('@fleet/api - ErpInboundController', () => {
  let recordInvoiceAck: ReturnType<typeof vi.fn>;
  let svc: ErpInboundService;
  let ctl: ErpInboundController;

  const SECRET = 'test-secret'; // pragma: allowlist secret
  const config = { get: (key: string): unknown => (key === 'ERP_WEBHOOK_SECRET' ? SECRET : undefined) } as ConfigService;
  beforeEach(() => {
    recordInvoiceAck = vi.fn();
    svc = { recordInvoiceAck } as unknown as ErpInboundService;
    ctl = new ErpInboundController(svc, config);
  });

  it('rejects request missing signature header', async () => {
    await expect(ctl.invoiceAck({ invoiceId: 'INV-1', manifestCorrelationId: '11111111-1111-4111-8111-111111111111', erpSystem: 'sap', status: 'acknowledged' }, undefined)).rejects.toThrow(/signature/i);
  });

  it('rejects request with bad signature', async () => {
    await expect(ctl.invoiceAck({ invoiceId: 'INV-1', manifestCorrelationId: '11111111-1111-4111-8111-111111111111', erpSystem: 'sap', status: 'acknowledged' }, 'bogus')).rejects.toThrow(/signature/i);
  });

  it('accepts valid signature and delegates', async () => {
    const { createHmac } = await import('node:crypto');
    const body = { invoiceId: 'INV-1', manifestCorrelationId: '11111111-1111-4111-8111-111111111111', erpSystem: 'sap', status: 'acknowledged' as const };
    const sig = createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex');
    recordInvoiceAck.mockResolvedValue({ updated: true });
    const res = await ctl.invoiceAck(body, sig);
    expect(res.updated).toBe(true);
  });
});
