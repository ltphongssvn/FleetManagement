// workers/main-worker/test/intake-policy.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateIntake, type IntakeInput } from '../src/intake/intake-policy.js';

const baseInput: IntakeInput = {
  expectedContentType: 'image/jpeg',
  expectedSizeBytes: 1_000_000,
  maxSizeBytes: 50 * 1024 * 1024,
  actualContentType: 'image/jpeg',
  actualSizeBytes: 1_000_000,
  providedHash: null,
  computedHash: null,
  virusScanClean: true,
};

describe('@fleet/main-worker - validateIntake', () => {
  it('accepts well-formed upload', () => {
    expect(validateIntake(baseInput)).toEqual({ accepted: true });
  });

  it('rejects when object is missing', () => {
    const r = validateIntake({ ...baseInput, actualContentType: null, actualSizeBytes: null });
    expect(r).toEqual({ accepted: false, rejectionCode: 'object_missing' });
  });

  it('rejects unsupported MIME type', () => {
    const r = validateIntake({ ...baseInput, actualContentType: 'image/gif', expectedContentType: 'image/gif' });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('mime_mismatch');
  });

  it('rejects MIME mismatch (actual != expected)', () => {
    const r = validateIntake({ ...baseInput, actualContentType: 'image/png' });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('mime_mismatch');
  });

  it('rejects oversized file (exceeds maxSizeBytes)', () => {
    const r = validateIntake({ ...baseInput, actualSizeBytes: 100 * 1024 * 1024 });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('oversized_file');
  });

  it('rejects size below 50% (large file, compression check)', () => {
    const r = validateIntake({ ...baseInput, actualSizeBytes: 100_000 });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('size_mismatch');
  });

  it('rejects when actual exceeds expected by more than absolute tolerance', () => {
    const r = validateIntake({ ...baseInput, actualSizeBytes: 1_010_000 });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('size_mismatch');
  });

  it('accepts when actual exceeds expected within absolute tolerance', () => {
    const r = validateIntake({ ...baseInput, actualSizeBytes: 1_004_000 });
    expect(r.accepted).toBe(true);
  });

  it('accepts tiny file even when ratio is below 0.5 (absolute tolerance)', () => {
    const r = validateIntake({ ...baseInput, expectedSizeBytes: 200, actualSizeBytes: 50 });
    expect(r.accepted).toBe(true);
  });

  it('rejects hash mismatch when both provided', () => {
    const r = validateIntake({ ...baseInput, providedHash: 'aaa', computedHash: 'bbb' });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('hash_mismatch');
  });

  it('rejects when client provided hash but intake did not compute one (fail-closed)', () => {
    const r = validateIntake({ ...baseInput, providedHash: 'aaa', computedHash: null });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('hash_missing');
  });

  it('skips hash check when client did not commit to one', () => {
    const r = validateIntake({ ...baseInput, providedHash: null, computedHash: 'bbb' });
    expect(r.accepted).toBe(true);
  });

  it('rejects when virus scan flagged', () => {
    const r = validateIntake({ ...baseInput, virusScanClean: false });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('virus_detected');
  });

  it('rejects when virus scan not yet completed (fail-closed)', () => {
    const r = validateIntake({ ...baseInput, virusScanClean: null });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('virus_scan_pending');
  });

  describe('property-based invariants', () => {
    it('always returns accepted=true or accepted=false (never throws)', () => {
      fc.assert(
        fc.property(
          fc.record({
            actualSizeBytes: fc.oneof(fc.integer({ min: 0, max: 100_000_000 }), fc.constant(null)),
            expectedSizeBytes: fc.integer({ min: 1, max: 10_000_000 }),
            providedHash: fc.oneof(fc.string({ minLength: 32, maxLength: 64 }), fc.constant(null)),
            computedHash: fc.oneof(fc.string({ minLength: 32, maxLength: 64 }), fc.constant(null)),
            virusScanClean: fc.oneof(fc.boolean(), fc.constant(null)),
          }),
          (overrides) => {
            const r = validateIntake({ ...baseInput, ...overrides });
            return typeof r.accepted === 'boolean';
          },
        ),
      );
    });

    it('accepted result never carries a rejectionCode', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1_000, max: 10_000_000 }), (size) => {
          const r = validateIntake({ ...baseInput, expectedSizeBytes: size, actualSizeBytes: size });
          return r.accepted ? !('rejectionCode' in r) : true;
        }),
      );
    });

    it('rejected result always carries a rejectionCode', () => {
      fc.assert(
        fc.property(fc.constantFrom('image/gif', 'video/mp4', 'application/zip'), (badMime) => {
          const r = validateIntake({ ...baseInput, actualContentType: badMime });
          return !r.accepted && typeof r.rejectionCode === 'string';
        }),
      );
    });
  });
});
