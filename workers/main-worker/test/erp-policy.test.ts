// workers/main-worker/test/erp-policy.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ERP_AMOUNT_CENTS_MAX } from '@fleet/sync-protocol';
import {
  buildErpInvoice,
  nextErpStatus,
  ERP_POLICY_VERSION,
  type ErpInvoicePayload,
  type ErpMappingContext,
} from '../src/erp/erp-policy.js';
const validPayload: ErpInvoicePayload = {
  manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
  transportOrderId: '22222222-2222-4222-8222-222222222222',
  internalCustomerId: '33333333-3333-4333-8333-333333333333',
  internalJobCode: 'PICKUP-A',
  amountCents: 12500,
  currency: 'USD',
  erpSystem: 'pilot-erp',
};
const validMapping: ErpMappingContext = {
  customerExternalId: 'ERP-CUST-1001',
  jobCodeExternalId: 'ERP-JOB-A',
};
describe('@fleet/main-worker - buildErpInvoice', () => {
  it('builds mapped payload for valid input', () => {
    const r = buildErpInvoice(validPayload, validMapping);
    expect(r.accepted).toBe(true);
    if (r.accepted) {
      expect(r.mappedPayload.customerExternalId).toBe('ERP-CUST-1001');
      expect(r.mappedPayload.jobCodeExternalId).toBe('ERP-JOB-A');
      expect(r.policyVersion).toBe(ERP_POLICY_VERSION);
    }
  });
  it('rejects when customer is not mapped, with internal id in details', () => {
    const r = buildErpInvoice(validPayload, { ...validMapping, customerExternalId: null });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('unknown_customer');
    expect(r.details.internalId).toBe(validPayload.internalCustomerId);
    expect(r.details.missingField).toBe('customerExternalId');
  });
  it('rejects when job code is not mapped, with missingField and internal id in details', () => {
    const r = buildErpInvoice(validPayload, { ...validMapping, jobCodeExternalId: null });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('unknown_job_code');
    expect(r.details.missingField).toBe('jobCodeExternalId');
    expect(r.details.internalId).toBe(validPayload.internalJobCode);
  });
  it('rejects negative amount, with amountCents missingField and invalidValue in details', () => {
    const r = buildErpInvoice({ ...validPayload, amountCents: -100 }, validMapping);
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('invalid_payload');
    expect(r.details.missingField).toBe('amountCents');
    expect(r.details.invalidValue).toBe(-100);
  });
  it('rejects zero amount', () => {
    const r = buildErpInvoice({ ...validPayload, amountCents: 0 }, validMapping);
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('invalid_payload');
    expect(r.details.missingField).toBe('amountCents');
    expect(r.details.invalidValue).toBe(0);
  });
  it('rejects NaN amount', () => {
    const r = buildErpInvoice({ ...validPayload, amountCents: Number.NaN }, validMapping);
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('invalid_payload');
  });
  it('rejects fractional amountCents (must be safe integer)', () => {
    const r = buildErpInvoice({ ...validPayload, amountCents: 12.5 }, validMapping);
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('invalid_payload');
  });
  it('rejects amountCents above MAX_SAFE_INTEGER', () => {
    const r = buildErpInvoice({ ...validPayload, amountCents: Number.MAX_SAFE_INTEGER + 1 }, validMapping);
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('invalid_payload');
  });
  it('accepts amountCents exactly at ERP_AMOUNT_CENTS_MAX (inclusive upper bound)', () => {
    const r = buildErpInvoice({ ...validPayload, amountCents: ERP_AMOUNT_CENTS_MAX }, validMapping);
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.mappedPayload.amountCents).toBe(ERP_AMOUNT_CENTS_MAX);
  });
  it('rejects amountCents one above ERP_AMOUNT_CENTS_MAX (exclusive past the cap)', () => {
    const r = buildErpInvoice({ ...validPayload, amountCents: ERP_AMOUNT_CENTS_MAX + 1 }, validMapping);
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('invalid_payload');
    expect(r.details.missingField).toBe('amountCents');
    expect(r.details.invalidValue).toBe(ERP_AMOUNT_CENTS_MAX + 1);
  });
  it('rejects unknown 3-letter currency, with currency missingField and invalidValue in details', () => {
    const r = buildErpInvoice({ ...validPayload, currency: 'ZZZ' }, validMapping);
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('invalid_payload');
    expect(r.details.missingField).toBe('currency');
    expect(r.details.invalidValue).toBe('ZZZ');
  });
  it('rejects malformed currency length', () => {
    const r = buildErpInvoice({ ...validPayload, currency: 'DOLLARS' }, validMapping);
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('invalid_payload');
    expect(r.details.missingField).toBe('currency');
    expect(r.details.invalidValue).toBe('DOLLARS');
  });
  it('accepts EUR/GBP/CAD/MXN from pilot allowlist', () => {
    for (const cur of ['EUR', 'GBP', 'CAD', 'MXN']) {
      const r = buildErpInvoice({ ...validPayload, currency: cur }, validMapping);
      expect(r.accepted).toBe(true);
    }
  });
  it('stamps policyVersion on every decision', () => {
    const accepted = buildErpInvoice(validPayload, validMapping);
    const rejected = buildErpInvoice(validPayload, { ...validMapping, customerExternalId: null });
    expect(accepted.policyVersion).toBe(ERP_POLICY_VERSION);
    expect(rejected.policyVersion).toBe(ERP_POLICY_VERSION);
  });
  describe('property-based invariants', () => {
    it('output policyVersion is always non-empty string', () => {
      fc.assert(
        fc.property(
          fc.record({
            amountCents: fc.oneof(fc.integer({ min: -1000, max: 1_000_000 }), fc.constant(Number.NaN)),
            currency: fc.constantFrom('USD', 'EUR', 'GBP', 'JPY', 'ZZZ', 'DOLLARS'),
          }),
          fc.record({
            customerExternalId: fc.oneof(fc.string({ minLength: 5 }), fc.constant(null)),
            jobCodeExternalId: fc.oneof(fc.string({ minLength: 5 }), fc.constant(null)),
          }),
          (p, m) => {
            const r = buildErpInvoice({ ...validPayload, ...p }, m);
            return typeof r.policyVersion === 'string' && r.policyVersion.length > 0;
          },
        ),
        { numRuns: 50 },
      );
    });
    it('rejection always carries details with missingField', () => {
      fc.assert(
        fc.property(fc.constantFrom(null), (nullVal) => {
          const r = buildErpInvoice(validPayload, { ...validMapping, customerExternalId: nullVal });
          return !r.accepted && typeof r.details.missingField === 'string';
        }),
      );
    });
  });
});
describe('@fleet/main-worker - nextErpStatus', () => {
  it('pending -> sent on outcome=sent', () => {
    expect(nextErpStatus('pending', 'sent')).toBe('sent');
  });
  it('sent -> acknowledged on outcome=acknowledged', () => {
    expect(nextErpStatus('sent', 'acknowledged')).toBe('acknowledged');
  });
  it('any -> failed on outcome=failed', () => {
    expect(nextErpStatus('pending', 'failed')).toBe('failed');
    expect(nextErpStatus('sent', 'failed')).toBe('failed');
  });
  it('acknowledged is terminal', () => {
    expect(nextErpStatus('acknowledged', 'sent')).toBe('acknowledged');
    expect(nextErpStatus('acknowledged', 'failed')).toBe('acknowledged');
    expect(nextErpStatus('acknowledged', 'acknowledged')).toBe('acknowledged');
  });
  it('allows pending -> acknowledged (webhook race)', () => {
    expect(nextErpStatus('pending', 'acknowledged')).toBe('acknowledged');
  });
  it('allows failed -> sent for retry', () => {
    expect(nextErpStatus('failed', 'sent')).toBe('sent');
  });
  it('allows failed -> acknowledged after transient failure', () => {
    expect(nextErpStatus('failed', 'acknowledged')).toBe('acknowledged');
  });
});
