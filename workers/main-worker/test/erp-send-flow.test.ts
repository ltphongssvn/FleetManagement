// workers/main-worker/test/erp-send-flow.test.ts
import { describe, it, expect, vi } from 'vitest';
import { sendErpInvoice } from '../src/erp/erp-send-flow.js';
import type { ErpJobData } from '../src/erp/erp-job.js';

const validJob: ErpJobData = {
  payload: {
    manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
    transportOrderId: '22222222-2222-7222-8222-222222222222',
    internalCustomerId: '33333333-3333-7333-8333-333333333333',
    internalJobCode: 'JOB-1',
    amountCents: 5000,
    currency: 'USD',
    erpSystem: 'sap',
  },
  mapping: { customerExternalId: 'CUST-1', jobCodeExternalId: 'JOB-EXT-1' },
};

describe('@fleet/main-worker - sendErpInvoice', () => {
  it('builds invoice + calls client when policy accepts', async () => {
    const send = vi.fn().mockResolvedValue({ externalInvoiceId: 'EXT-9' });
    const result = await sendErpInvoice(validJob, { sendInvoice: send });
    expect(result.kind).toBe('sent');
    if (result.kind === 'sent') expect(result.externalInvoiceId).toBe('EXT-9');
  });

  it('returns rejected when mapping missing', async () => {
    const send = vi.fn();
    const result = await sendErpInvoice({ ...validJob, mapping: { customerExternalId: null, jobCodeExternalId: 'JOB-EXT-1' } }, { sendInvoice: send });
    expect(result.kind).toBe('rejected');
    expect(send).not.toHaveBeenCalled();
  });

  it('returns failed when client throws', async () => {
    const send = vi.fn().mockRejectedValue(new Error('erp 503'));
    const result = await sendErpInvoice(validJob, { sendInvoice: send });
    expect(result.kind).toBe('failed');
  });

  it('wraps non-Error throw into Error in failed outcome', async () => {
    const send = vi.fn().mockRejectedValue('plain string failure');
    const result = await sendErpInvoice(validJob, { sendInvoice: send });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('plain string failure');
    }
  });
});
