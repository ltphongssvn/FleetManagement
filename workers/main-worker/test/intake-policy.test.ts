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

  it('accepts tiny file even when ratio is below 0.5 (absolute tolerance)', () => {
    const r = validateIntake({ ...baseInput, expectedSizeBytes: 200, actualSizeBytes: 50 });
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
