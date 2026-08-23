// packages/sync-protocol/test/erp-types.test.ts
// Mutation-killing tests for the ERP wire schemas.
// Coverage philosophy: each .min(), .max(), and .strict() boundary must be
// exercised by both accept and reject cases so Stryker can't silently swap
// them. The z.object().strict() schemas reject extra keys; the .strict()
// behavior is exercised here too.
import { describe, it, expect } from 'vitest';
import {
  ErpInvoicePayloadWireSchema,
  ErpMappingContextWireSchema,
  ErpJobDataWireSchema,
  ERP_AMOUNT_CENTS_MAX,
  PILOT_CURRENCIES,
} from '../src/erp-types.js';

const validPayload = {
  manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
  transportOrderId: '22222222-2222-4222-8222-222222222222',
  internalCustomerId: '33333333-3333-4333-8333-333333333333',
  internalJobCode: 'JOB-1',
  amountCents: 100_000,
  currency: 'USD',
  erpSystem: 'sap-s4',
};

const validMapping = {
  customerExternalId: 'EXT-CUST-1',
  jobCodeExternalId: 'EXT-JOB-1',
};

describe('ErpInvoicePayloadWireSchema', () => {
  it('accepts a well-formed payload', () => {
    expect(ErpInvoicePayloadWireSchema.parse(validPayload)).toEqual(validPayload);
  });

  it('rejects empty object (kills object-literal -> {} mutant)', () => {
    expect(() => ErpInvoicePayloadWireSchema.parse({})).toThrow();
  });

  it('rejects extra unknown keys due to .strict() (kills .strict() removal)', () => {
    expect(() => ErpInvoicePayloadWireSchema.parse({ ...validPayload, extra: 'x' })).toThrow();
  });

  it('internalJobCode: rejects empty string (kills min(1) -> max(1) mutant)', () => {
    expect(() =>
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, internalJobCode: '' }),
    ).toThrow();
  });

  it('internalJobCode: accepts 64-char (max boundary, kills min(1).min(64) mutant)', () => {
    const sixtyfour = 'a'.repeat(64);
    expect(
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, internalJobCode: sixtyfour })
        .internalJobCode,
    ).toBe(sixtyfour);
  });

  it('internalJobCode: rejects 65-char (kills max(64) -> min(64) mutant)', () => {
    const sixtyfive = 'a'.repeat(65);
    expect(() =>
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, internalJobCode: sixtyfive }),
    ).toThrow();
  });

  it('amountCents: rejects zero (positive constraint must be intact)', () => {
    expect(() => ErpInvoicePayloadWireSchema.parse({ ...validPayload, amountCents: 0 })).toThrow();
  });

  it('amountCents: accepts ERP_AMOUNT_CENTS_MAX exactly (kills max -> min mutant)', () => {
    expect(
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, amountCents: ERP_AMOUNT_CENTS_MAX })
        .amountCents,
    ).toBe(ERP_AMOUNT_CENTS_MAX);
  });

  it('amountCents: rejects ERP_AMOUNT_CENTS_MAX + 1 (kills max -> min mutant from the other side)', () => {
    expect(() =>
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, amountCents: ERP_AMOUNT_CENTS_MAX + 1 }),
    ).toThrow();
  });

  it('amountCents: rejects non-integer (decimals)', () => {
    expect(() =>
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, amountCents: 100.5 }),
    ).toThrow();
  });

  it('currency: accepts each pilot currency', () => {
    for (const c of PILOT_CURRENCIES) {
      expect(ErpInvoicePayloadWireSchema.parse({ ...validPayload, currency: c }).currency).toBe(c);
    }
  });

  it('currency: rejects unknown currency code', () => {
    expect(() => ErpInvoicePayloadWireSchema.parse({ ...validPayload, currency: 'JPY' })).toThrow();
  });

  it('erpSystem: rejects empty string (kills min(1) -> max(1) mutant)', () => {
    expect(() => ErpInvoicePayloadWireSchema.parse({ ...validPayload, erpSystem: '' })).toThrow();
  });

  it('erpSystem: accepts 64-char (kills min(1).min(64) mutant)', () => {
    const sixtyfour = 'b'.repeat(64);
    expect(
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, erpSystem: sixtyfour }).erpSystem,
    ).toBe(sixtyfour);
  });

  it('erpSystem: rejects 65-char (kills max(64) -> min(64) mutant)', () => {
    const sixtyfive = 'b'.repeat(65);
    expect(() =>
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, erpSystem: sixtyfive }),
    ).toThrow();
  });

  it('UUID fields: reject non-UUID strings', () => {
    expect(() =>
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, manifestCorrelationId: 'not-a-uuid' }),
    ).toThrow();
    expect(() =>
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, transportOrderId: 'not-a-uuid' }),
    ).toThrow();
    expect(() =>
      ErpInvoicePayloadWireSchema.parse({ ...validPayload, internalCustomerId: 'not-a-uuid' }),
    ).toThrow();
  });
});

describe('ErpMappingContextWireSchema', () => {
  it('accepts a well-formed mapping', () => {
    expect(ErpMappingContextWireSchema.parse(validMapping)).toEqual(validMapping);
  });

  it('accepts null for both externalIds (union must allow null)', () => {
    const r = ErpMappingContextWireSchema.parse({
      customerExternalId: null,
      jobCodeExternalId: null,
    });
    expect(r.customerExternalId).toBeNull();
    expect(r.jobCodeExternalId).toBeNull();
  });

  it('rejects empty object (kills object-literal -> {} mutant)', () => {
    expect(() => ErpMappingContextWireSchema.parse({})).toThrow();
  });

  it('rejects extra unknown keys due to .strict()', () => {
    expect(() => ErpMappingContextWireSchema.parse({ ...validMapping, extra: 'x' })).toThrow();
  });

  it('customerExternalId: rejects empty string (kills min(1) -> max(1) mutant)', () => {
    expect(() =>
      ErpMappingContextWireSchema.parse({ ...validMapping, customerExternalId: '' }),
    ).toThrow();
  });

  it('customerExternalId: accepts 128-char (kills max boundary mutants)', () => {
    const long = 'c'.repeat(128);
    expect(
      ErpMappingContextWireSchema.parse({ ...validMapping, customerExternalId: long })
        .customerExternalId,
    ).toBe(long);
  });

  it('customerExternalId: rejects 129-char (kills max(128) -> min(128) mutant)', () => {
    const tooLong = 'c'.repeat(129);
    expect(() =>
      ErpMappingContextWireSchema.parse({ ...validMapping, customerExternalId: tooLong }),
    ).toThrow();
  });

  it('customerExternalId: rejects union shape mutated to []', () => {
    // Mutant: z.union([z.string(), z.null()]) -> z.union([]). An empty union
    // rejects everything. So the valid input above already kills it, but
    // assert specifically that valid strings AND null are both accepted.
    expect(() =>
      ErpMappingContextWireSchema.parse({ ...validMapping, customerExternalId: 'ok' }),
    ).not.toThrow();
    expect(() =>
      ErpMappingContextWireSchema.parse({ ...validMapping, customerExternalId: null }),
    ).not.toThrow();
  });

  it('jobCodeExternalId: rejects empty string + accepts 128-char + rejects 129-char (kills max/min mutants)', () => {
    expect(() =>
      ErpMappingContextWireSchema.parse({ ...validMapping, jobCodeExternalId: '' }),
    ).toThrow();
    const long = 'd'.repeat(128);
    expect(
      ErpMappingContextWireSchema.parse({ ...validMapping, jobCodeExternalId: long })
        .jobCodeExternalId,
    ).toBe(long);
    const tooLong = 'd'.repeat(129);
    expect(() =>
      ErpMappingContextWireSchema.parse({ ...validMapping, jobCodeExternalId: tooLong }),
    ).toThrow();
  });

  it('jobCodeExternalId: union accepts both string and null', () => {
    expect(() =>
      ErpMappingContextWireSchema.parse({ ...validMapping, jobCodeExternalId: 'ok' }),
    ).not.toThrow();
    expect(() =>
      ErpMappingContextWireSchema.parse({ ...validMapping, jobCodeExternalId: null }),
    ).not.toThrow();
  });
});

describe('ErpJobDataWireSchema', () => {
  it('accepts a well-formed job (payload + mapping)', () => {
    const job = { payload: validPayload, mapping: validMapping };
    expect(ErpJobDataWireSchema.parse(job)).toEqual(job);
  });

  it('rejects empty object (kills composite object-literal -> {} mutant)', () => {
    expect(() => ErpJobDataWireSchema.parse({})).toThrow();
  });

  it('requires payload field', () => {
    expect(() => ErpJobDataWireSchema.parse({ mapping: validMapping })).toThrow();
  });

  it('requires mapping field', () => {
    expect(() => ErpJobDataWireSchema.parse({ payload: validPayload })).toThrow();
  });

  it('rejects extra unknown keys at the top level (.strict())', () => {
    expect(() =>
      ErpJobDataWireSchema.parse({ payload: validPayload, mapping: validMapping, extra: 'x' }),
    ).toThrow();
  });
});
