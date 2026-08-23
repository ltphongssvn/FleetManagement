// workers/main-worker/test/erp-processor.test.ts
import { describe, it, expect } from 'vitest';
import { ErpProcessor } from '../src/erp/erp-processor.js';
import { ErpJobDataSchema, type ErpJobData } from '../src/erp/erp-job.js';
import { ERP_POLICY_VERSION } from '../src/erp/erp-policy.js';

const validJob: ErpJobData = {
  payload: {
    manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
    transportOrderId: '22222222-2222-4222-8222-222222222222',
    internalCustomerId: '33333333-3333-4333-8333-333333333333',
    internalJobCode: 'JOB-PILOT-001',
    amountCents: 250_000,
    currency: 'USD',
    erpSystem: 'pilot-erp',
  },
  mapping: {
    customerExternalId: 'EXT-CUST-42',
    jobCodeExternalId: 'EXT-JOB-7',
  },
};

describe('@fleet/main-worker - ErpProcessor', () => {
  it('accepts valid job + mapping and returns mapped payload', () => {
    const result = new ErpProcessor().process(validJob);
    expect(result.accepted).toBe(true);
    expect(result.policyVersion).toBe(ERP_POLICY_VERSION);
    if (result.accepted) {
      expect(result.mappedPayload.customerExternalId).toBe('EXT-CUST-42');
      expect(result.mappedPayload.jobCodeExternalId).toBe('EXT-JOB-7');
    }
  });

  it('rejects when customer mapping is missing (unknown_customer)', () => {
    const result = new ErpProcessor().process({
      ...validJob,
      mapping: { ...validJob.mapping, customerExternalId: null },
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.rejectionCode).toBe('unknown_customer');
  });

  it('rejects when job code mapping is missing (unknown_job_code)', () => {
    const result = new ErpProcessor().process({
      ...validJob,
      mapping: { ...validJob.mapping, jobCodeExternalId: null },
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.rejectionCode).toBe('unknown_job_code');
  });
});

describe('@fleet/main-worker - ErpJobDataSchema (boundary validation)', () => {
  it('parses well-formed payload', () => {
    const parsed = ErpJobDataSchema.parse(validJob);
    expect(parsed.payload.currency).toBe('USD');
  });

  it('rejects non-UUID transportOrderId', () => {
    expect(() =>
      ErpJobDataSchema.parse({
        ...validJob,
        payload: { ...validJob.payload, transportOrderId: 'nope' },
      }),
    ).toThrow();
  });

  it('rejects unsupported currency', () => {
    expect(() =>
      ErpJobDataSchema.parse({
        ...validJob,
        payload: { ...validJob.payload, currency: 'JPY' },
      }),
    ).toThrow();
  });

  it('rejects negative amount', () => {
    expect(() =>
      ErpJobDataSchema.parse({
        ...validJob,
        payload: { ...validJob.payload, amountCents: -1 },
      }),
    ).toThrow();
  });

  it('accepts null mapping fields (policy enforces unknown_customer/job_code)', () => {
    const parsed = ErpJobDataSchema.parse({
      ...validJob,
      mapping: { customerExternalId: null, jobCodeExternalId: null },
    });
    expect(parsed.mapping.customerExternalId).toBeNull();
  });
});

describe('@fleet/main-worker - ErpJobDataSchema strictness + amount edges', () => {
  it('rejects extra top-level field (.strict)', () => {
    expect(() => ErpJobDataSchema.parse({ ...validJob, extra: 'no' })).toThrow();
  });

  it('rejects extra payload field (.strict)', () => {
    expect(() =>
      ErpJobDataSchema.parse({
        ...validJob,
        payload: { ...validJob.payload, extra: 'no' },
      }),
    ).toThrow();
  });

  it('rejects extra mapping field (.strict)', () => {
    expect(() =>
      ErpJobDataSchema.parse({
        ...validJob,
        mapping: { ...validJob.mapping, extra: 'no' },
      }),
    ).toThrow();
  });

  it('rejects fractional amountCents', () => {
    expect(() =>
      ErpJobDataSchema.parse({
        ...validJob,
        payload: { ...validJob.payload, amountCents: 100.5 },
      }),
    ).toThrow();
  });

  it('rejects zero amountCents', () => {
    expect(() =>
      ErpJobDataSchema.parse({
        ...validJob,
        payload: { ...validJob.payload, amountCents: 0 },
      }),
    ).toThrow();
  });

  it('rejects amountCents above max cap', () => {
    expect(() =>
      ErpJobDataSchema.parse({
        ...validJob,
        payload: { ...validJob.payload, amountCents: 1_000_000_001 },
      }),
    ).toThrow();
  });

  it('rejects empty customerExternalId', () => {
    expect(() =>
      ErpJobDataSchema.parse({
        ...validJob,
        mapping: { ...validJob.mapping, customerExternalId: '' },
      }),
    ).toThrow();
  });

  it('rejects empty erpSystem', () => {
    expect(() =>
      ErpJobDataSchema.parse({
        ...validJob,
        payload: { ...validJob.payload, erpSystem: '' },
      }),
    ).toThrow();
  });
});
