// packages/domain/test/manifest-rejection-reason.test.ts
import { describe, it, expect } from 'vitest';
import {
  MANIFEST_REJECTION_REASONS,
  ManifestRejectionReasonSchema,
  type ManifestRejectionReason,
} from '../src/manifest/manifest-rejection-reason.js';

describe('@fleet/domain - MANIFEST_REJECTION_REASONS', () => {
  it('exports the canonical 9-value enum', () => {
    expect(MANIFEST_REJECTION_REASONS).toEqual([
      'blurred_image', 'wrong_manifest', 'missing_page', 'oversized_file',
      'unsupported_format', 'duplicate_upload', 'hash_mismatch',
      'virus_detected', 'other',
    ]);
  });
  it('Zod schema accepts canonical values', () => {
    for (const r of MANIFEST_REJECTION_REASONS) {
      expect(ManifestRejectionReasonSchema.safeParse(r).success).toBe(true);
    }
  });
  it('Zod schema rejects unknown values', () => {
    expect(ManifestRejectionReasonSchema.safeParse('not_a_real_reason').success).toBe(false);
    expect(ManifestRejectionReasonSchema.safeParse('').success).toBe(false);
  });
  it('type narrows to literal union', () => {
    const r: ManifestRejectionReason = 'other';
    expect(r).toBe('other');
  });
});
