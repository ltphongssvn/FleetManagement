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

describe('ExtractionResultWireSchema invariant', () => {
  const m = job.manifestId;
  it('extracted requires positive kg', () => {
    expect(ExtractionResultWireSchema.safeParse({ manifestId: m, status: 'extracted', extractedNetWeightKg: 20730 }).success).toBe(true);
    expect(ExtractionResultWireSchema.safeParse({ manifestId: m, status: 'extracted', extractedNetWeightKg: null }).success).toBe(false);
  });
  it('not_found / unreadable require null kg', () => {
    expect(ExtractionResultWireSchema.safeParse({ manifestId: m, status: 'not_found', extractedNetWeightKg: null }).success).toBe(true);
    expect(ExtractionResultWireSchema.safeParse({ manifestId: m, status: 'unreadable', extractedNetWeightKg: 99 }).success).toBe(false);
  });
});
