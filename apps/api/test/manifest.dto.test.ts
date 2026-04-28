// apps/api/test/manifest.dto.test.ts
import { describe, it, expect } from 'vitest';
import { NegotiateUploadSchema } from '../src/manifest/manifest.dto.js';

const valid = {
  manifestCorrelationId: '00000000-0000-0000-0000-000000000001',
  transportOrderId: '00000000-0000-0000-0000-000000000002',
  contentType: 'image/jpeg' as const,
  expectedSizeBytes: 1_500_000,
};

describe('@fleet/api - NegotiateUploadSchema', () => {
  it('accepts valid input', () => {
    expect(NegotiateUploadSchema.parse(valid)).toEqual(valid);
  });

  it('rejects unsupported content type', () => {
    expect(NegotiateUploadSchema.safeParse({ ...valid, contentType: 'image/gif' }).success).toBe(false);
  });

  it('rejects file exceeding 50MB cap', () => {
    expect(NegotiateUploadSchema.safeParse({ ...valid, expectedSizeBytes: 60 * 1024 * 1024 }).success).toBe(false);
  });

  it('rejects non-positive size', () => {
    expect(NegotiateUploadSchema.safeParse({ ...valid, expectedSizeBytes: 0 }).success).toBe(false);
  });

  it('rejects non-uuid correlation id', () => {
    expect(NegotiateUploadSchema.safeParse({ ...valid, manifestCorrelationId: 'bad' }).success).toBe(false);
  });
});
