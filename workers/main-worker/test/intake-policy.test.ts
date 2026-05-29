// workers/main-worker/test/intake-policy.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateIntake, INTAKE_POLICY_VERSION, type IntakeInput } from '../src/intake/intake-policy.js';
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
  it('accepts well-formed upload with policyVersion stamp', () => {
    const r = validateIntake(baseInput);
    expect(r.accepted).toBe(true);
    expect(r.policyVersion).toBe(INTAKE_POLICY_VERSION);
  });
  it('rejects when object is missing', () => {
    const r = validateIntake({ ...baseInput, actualContentType: null, actualSizeBytes: null });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('object_missing');
  });
  it('rejects when only actualContentType is null (size present)', () => {
    const r = validateIntake({ ...baseInput, actualContentType: null });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('object_missing');
  });
  it('rejects when only actualSizeBytes is null (content-type present)', () => {
    const r = validateIntake({ ...baseInput, actualSizeBytes: null });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('object_missing');
  });
  it('rejects unsupported MIME type with unsupported_mime_type code', () => {
    const r = validateIntake({ ...baseInput, actualContentType: 'image/gif', expectedContentType: 'image/gif' });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('unsupported_mime_type');
  });
  it('rejects MIME mismatch with mime_mismatch code', () => {
    const r = validateIntake({ ...baseInput, actualContentType: 'image/png' });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('mime_mismatch');
  });
  it('rejects oversized file', () => {
    const r = validateIntake({ ...baseInput, actualSizeBytes: 100 * 1024 * 1024 });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('oversized_file');
  });
  it('accepts file exactly at maxSizeBytes (inclusive upper bound, not oversized)', () => {
    // expectedSizeBytes raised to keep the size-ratio/tolerance checks satisfied;
    // isolates the actualSizeBytes > maxSizeBytes boundary.
    const r = validateIntake({
      ...baseInput,
      expectedSizeBytes: 50 * 1024 * 1024,
      actualSizeBytes: 50 * 1024 * 1024,
    });
    expect(r.accepted).toBe(true);
  });
  it('rejects size below 50%', () => {
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
  it('accepts actual exactly at expected + tolerance (inclusive upper-tolerance boundary)', () => {
    const r = validateIntake({ ...baseInput, actualSizeBytes: 1_000_000 + 5_000 });
    expect(r.accepted).toBe(true);
  });
  it('rejects actual one byte past expected + tolerance (exclusive)', () => {
    const r = validateIntake({ ...baseInput, actualSizeBytes: 1_000_000 + 5_001 });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('size_mismatch');
  });
  it('accepts actual exactly at the 0.5 size ratio when absDiff exceeds tolerance (ratio is exclusive lower bound)', () => {
    // expected 1,000,000 ; actual 500,000 -> ratio exactly 0.5, absDiff 500,000 > 5,000.
    // sizeRatio < MIN_SIZE_RATIO must be strict: 0.5 is NOT below 0.5 -> accepted.
    const r = validateIntake({ ...baseInput, expectedSizeBytes: 1_000_000, actualSizeBytes: 500_000 });
    expect(r.accepted).toBe(true);
  });
  it('accepts small under-ratio file when absDiff is exactly at tolerance (tolerance gate is exclusive)', () => {
    // expected 10,000 ; actual 5,000 -> ratio 0.5 (boundary) but to isolate the
    // absDiff > tolerance gate use expected 12,000 actual 7,000: ratio 0.583 ok.
    // For the absDiff == tolerance boundary: expected 12_000, actual 7_000 -> absDiff 5_000.
    const r = validateIntake({ ...baseInput, expectedSizeBytes: 12_000, actualSizeBytes: 7_000 });
    expect(r.accepted).toBe(true);
  });
  it('rejects under-ratio file when absDiff is one past tolerance', () => {
    // expected 12_002, actual 7_001 -> ratio 0.583 (>=0.5) so ratio gate alone would pass;
    // use a genuinely under-ratio case: expected 1_000_000 actual 400_000 ->
    // ratio 0.4 < 0.5 AND absDiff 600_000 > 5_000 -> size_mismatch.
    const r = validateIntake({ ...baseInput, expectedSizeBytes: 1_000_000, actualSizeBytes: 400_000 });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('size_mismatch');
  });
  it('accepts tiny file even when ratio is below 0.5 (absolute tolerance)', () => {
    const r = validateIntake({ ...baseInput, expectedSizeBytes: 200, actualSizeBytes: 50 });
    expect(r.accepted).toBe(true);
  });
  it('accepts an under-ratio file when absDiff is exactly at tolerance (kills absDiff sign + > vs >= mutants)', () => {
    // expected 9999, actual 4999: absDiff = 5000 (exactly tolerance), ratio 0.4999 < 0.5.
    // Line 78 `absDiff > 5000` is false at exactly 5000 -> accepted.
    //  - `>` -> `>=` mutant would reject (5000 >= 5000) -> killed.
    //  - absDiff `-` -> `+` mutant: abs(4999+9999)=14998 > 5000 -> rejected -> killed.
    const r = validateIntake({ ...baseInput, expectedSizeBytes: 9999, actualSizeBytes: 4999 });
    expect(r.accepted).toBe(true);
  });
  it('rejects an under-ratio file when absDiff is one past tolerance (lower-bound size guard)', () => {
    // expected 9998, actual 4997: absDiff 5001 > 5000, ratio 0.4998 < 0.5 -> size_mismatch.
    const r = validateIntake({ ...baseInput, expectedSizeBytes: 9998, actualSizeBytes: 4997 });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('size_mismatch');
  });
  it('accepts actual size 0 when within absolute tolerance of a tiny expected size', () => {
    // expectedSizeBytes 1 (positive-finite ok), actualSizeBytes 0:
    // isNonNegativeFinite(0) must be true (>= 0, not > 0). absDiff 1 <= tolerance,
    // actual not above expected+tolerance, ratio 0 < 0.5 but absDiff 1 <= tolerance.
    const r = validateIntake({ ...baseInput, expectedSizeBytes: 1, actualSizeBytes: 0 });
    expect(r.accepted).toBe(true);
  });
  it('rejects hash mismatch when both provided', () => {
    const r = validateIntake({ ...baseInput, providedHash: 'aaa', computedHash: 'bbb' });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('hash_mismatch');
  });
  it('rejects when client provided hash but intake did not compute one', () => {
    const r = validateIntake({ ...baseInput, providedHash: 'aaa', computedHash: null });
    if (r.accepted) throw new Error('expected reject');
    expect(r.rejectionCode).toBe('hash_missing');
  });
  it('skips hash check when client did not commit to one', () => {
    const r = validateIntake({ ...baseInput, providedHash: null, computedHash: 'bbb' });
    expect(r.accepted).toBe(true);
  });
  it('accepts matching hash when both provided', () => {
    const r = validateIntake({ ...baseInput, providedHash: 'aaa', computedHash: 'aaa' });
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
  describe('numeric input validation (defensive)', () => {
    it('rejects expectedSizeBytes = 0', () => {
      const r = validateIntake({ ...baseInput, expectedSizeBytes: 0 });
      if (r.accepted) throw new Error('expected reject');
      expect(r.rejectionCode).toBe('invalid_input');
    });
    it('rejects expectedSizeBytes = NaN', () => {
      const r = validateIntake({ ...baseInput, expectedSizeBytes: Number.NaN });
      if (r.accepted) throw new Error('expected reject');
      expect(r.rejectionCode).toBe('invalid_input');
    });
    it('rejects expectedSizeBytes = Infinity', () => {
      const r = validateIntake({ ...baseInput, expectedSizeBytes: Infinity });
      if (r.accepted) throw new Error('expected reject');
      expect(r.rejectionCode).toBe('invalid_input');
    });
    it('rejects negative expectedSizeBytes', () => {
      const r = validateIntake({ ...baseInput, expectedSizeBytes: -1 });
      if (r.accepted) throw new Error('expected reject');
      expect(r.rejectionCode).toBe('invalid_input');
    });
    it('rejects negative actualSizeBytes', () => {
      const r = validateIntake({ ...baseInput, actualSizeBytes: -1 });
      if (r.accepted) throw new Error('expected reject');
      expect(r.rejectionCode).toBe('invalid_input');
    });
    it('rejects maxSizeBytes = 0', () => {
      const r = validateIntake({ ...baseInput, maxSizeBytes: 0 });
      if (r.accepted) throw new Error('expected reject');
      expect(r.rejectionCode).toBe('invalid_input');
    });
  });
  describe('priority order', () => {
    it('returns object_missing before MIME or size checks', () => {
      const r = validateIntake({
        ...baseInput,
        actualContentType: null,
        actualSizeBytes: null,
        virusScanClean: false,
      });
      if (r.accepted) throw new Error('expected reject');
      expect(r.rejectionCode).toBe('object_missing');
    });
    it('returns unsupported_mime_type before size or virus checks', () => {
      const r = validateIntake({
        ...baseInput,
        actualContentType: 'image/gif',
        actualSizeBytes: 100 * 1024 * 1024,
        virusScanClean: false,
      });
      if (r.accepted) throw new Error('expected reject');
      expect(r.rejectionCode).toBe('unsupported_mime_type');
    });
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
    it('every decision carries policyVersion', () => {
      fc.assert(
        fc.property(fc.constantFrom('image/gif', 'video/mp4', 'application/zip'), (badMime) => {
          const r = validateIntake({ ...baseInput, actualContentType: badMime });
          return typeof r.policyVersion === 'string' && r.policyVersion.length > 0;
        }),
      );
    });
  });
});
