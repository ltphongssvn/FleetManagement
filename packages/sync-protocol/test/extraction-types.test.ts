// packages/sync-protocol/test/extraction-types.test.ts
import { describe, expect, it } from 'vitest';
import { ExtractionJobDataWireSchema, ExtractionResultWireSchema } from '../src/extraction-types.js';

const job = {
  manifestId: '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d',
  uploadSessionId: '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
  s3Key: 'tenant/m/x.jpg',
  s3Bucket: 'fleet-pilot-artifacts',
  contentType: 'image/jpeg',
};

describe('ExtractionJobDataWireSchema', () => {
  it('accepts a valid job body', () => {
    expect(ExtractionJobDataWireSchema.safeParse(job).success).toBe(true);
  });
  it('rejects unknown keys (strict)', () => {
    expect(ExtractionJobDataWireSchema.safeParse({ ...job, extra: 1 }).success).toBe(false);
  });
  it('rejects disallowed mime', () => {
    expect(ExtractionJobDataWireSchema.safeParse({ ...job, contentType: 'text/plain' }).success).toBe(false);
  });
});

const m = job.manifestId;
const ok = (b: unknown): boolean => ExtractionResultWireSchema.safeParse(b).success;

describe('ExtractionResultWireSchema kg-iff-extracted invariant', () => {
  it('extracted requires positive kg', () => {
    expect(ok({ manifestId: m, status: 'extracted', extractedNetWeightKg: 20730 })).toBe(true);
    expect(ok({ manifestId: m, status: 'extracted', extractedNetWeightKg: null })).toBe(false);
  });
  it('non-extracted requires null kg', () => {
    expect(ok({ manifestId: m, status: 'unreadable', extractedNetWeightKg: 99, reason: 'unparseable' })).toBe(false);
  });
});

describe('ExtractionResultWireSchema reason invariant (failure cause is SSOT, not lost as unreadable)', () => {
  it('a failure status carries its deterministic reason', () => {
    expect(ok({ manifestId: m, status: 'unreadable', extractedNetWeightKg: null, reason: 'unparseable' })).toBe(true);
    expect(ok({ manifestId: m, status: 'unreadable', extractedNetWeightKg: null, reason: 'below_sanity_min' })).toBe(true);
    expect(ok({ manifestId: m, status: 'unreadable', extractedNetWeightKg: null, reason: 'above_sanity_max' })).toBe(true);
    expect(ok({ manifestId: m, status: 'not_found', extractedNetWeightKg: null, reason: 'no_field' })).toBe(true);
    expect(ok({ manifestId: m, status: 'not_found', extractedNetWeightKg: null, reason: 'object_missing' })).toBe(true);
  });
  it('a failure status WITHOUT a reason is rejected', () => {
    expect(ok({ manifestId: m, status: 'not_found', extractedNetWeightKg: null })).toBe(false);
    expect(ok({ manifestId: m, status: 'unreadable', extractedNetWeightKg: null })).toBe(false);
  });
  it('extracted MUST NOT carry a reason', () => {
    expect(ok({ manifestId: m, status: 'extracted', extractedNetWeightKg: 20730, reason: 'unparseable' })).toBe(false);
  });
  it('rejects an unknown reason value', () => {
    expect(ok({ manifestId: m, status: 'not_found', extractedNetWeightKg: null, reason: 'bogus' })).toBe(false);
  });
});
