// apps/driver-app/test/manifest-capture-policy.test.ts
import { describe, it, expect } from 'vitest';
import {
  validateCapturedFile,
  validateSignaturePath,
  MANIFEST_CAPTURE_POLICY_VERSION,
  MANIFEST_MAX_FILE_BYTES,
  MANIFEST_MIN_FILE_BYTES,
  SIGNATURE_MIN_PATH_POINTS,
  SIGNATURE_MAX_PATH_POINTS,
  SIGNATURE_MAX_PATH_CHARS,
} from '../src/manifest/manifest-capture-policy.js';

describe('@fleet/driver-app - validateCapturedFile', () => {
  it('accepts valid jpeg', () => {
    const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes: 1_500_000 });
    expect(r.accepted).toBe(true);
    if (r.accepted) {
      expect(r.mimeType).toBe('image/jpeg');
      expect(r.policyVersion).toBe(MANIFEST_CAPTURE_POLICY_VERSION);
    }
  });

  it('accepts pdf', () => {
    const r = validateCapturedFile({ mimeType: 'application/pdf', sizeBytes: 50_000 });
    expect(r.accepted).toBe(true);
  });

  it('accepts png + heic', () => {
    expect(validateCapturedFile({ mimeType: 'image/png', sizeBytes: 200_000 }).accepted).toBe(true);
    expect(validateCapturedFile({ mimeType: 'image/heic', sizeBytes: 200_000 }).accepted).toBe(true);
  });

  it('rejects unsupported mime (gif)', () => {
    const r = validateCapturedFile({ mimeType: 'image/gif', sizeBytes: 200_000 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('invalid_mime');
  });

  it('rejects size < min', () => {
    const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes: MANIFEST_MIN_FILE_BYTES - 1 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('too_small');
  });

  it('rejects size > max', () => {
    const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes: MANIFEST_MAX_FILE_BYTES + 1 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('too_large');
  });

  it('rejects negative size', () => {
    const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes: -1 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('invalid_size');
  });

  it('rejects NaN size', () => {
    const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes: Number.NaN });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('invalid_size');
  });

  it('rejects Infinity size', () => {
    const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes: Number.POSITIVE_INFINITY });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('invalid_size');
  });


  it('rejects fractional sizeBytes (not safe integer)', () => {
    const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes: 1000.5 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('invalid_size');
  });
  it('accepts size at exact min boundary', () => {
    const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes: MANIFEST_MIN_FILE_BYTES });
    expect(r.accepted).toBe(true);
  });

  it('accepts size at exact max boundary', () => {
    const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes: MANIFEST_MAX_FILE_BYTES });
    expect(r.accepted).toBe(true);
  });
});

describe('@fleet/driver-app - validateSignaturePath', () => {
  it('accepts a typical signature path', () => {
    const r = validateSignaturePath({ d: 'M10 10 L20 20 L30 25 L40 30', pointCount: 50 });
    expect(r.accepted).toBe(true);
    if (r.accepted) {
      expect(r.normalizedD).toBe('M10 10 L20 20 L30 25 L40 30');
      expect(r.policyVersion).toBe(MANIFEST_CAPTURE_POLICY_VERSION);
    }
  });

  it('trims surrounding whitespace', () => {
    const r = validateSignaturePath({ d: '  M10 10 L20 20  ', pointCount: 10 });
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.normalizedD).toBe('M10 10 L20 20');
  });

  it('rejects empty path', () => {
    const r = validateSignaturePath({ d: '', pointCount: 0 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('signature_empty');
  });

  it('rejects path with too few points (liveness)', () => {
    const r = validateSignaturePath({ d: 'M10 10', pointCount: SIGNATURE_MIN_PATH_POINTS - 1 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('signature_empty');
  });

  it('rejects path with too many points', () => {
    const r = validateSignaturePath({ d: 'M0 0 ' + 'L1 1 '.repeat(20_000), pointCount: SIGNATURE_MAX_PATH_POINTS + 1 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('signature_too_long');
  });

  it('rejects negative pointCount', () => {
    const r = validateSignaturePath({ d: 'M10 10', pointCount: -1 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('signature_invalid');
  });

  it('rejects path that does not start with M (SVG moveto)', () => {
    const r = validateSignaturePath({ d: 'L10 20 L30 40', pointCount: 50 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('signature_invalid');
  });

  it('rejects gibberish path', () => {
    const r = validateSignaturePath({ d: 'banana', pointCount: 50 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('signature_invalid');
  });
});

import fc from 'fast-check';


  it('rejects fractional pointCount', () => {
    const r = validateSignaturePath({ d: 'M10 10 L20 20', pointCount: 5.5 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('signature_invalid');
  });

  it('rejects path with valid prefix but invalid suffix (no longer just prefix-checking)', () => {
    const r = validateSignaturePath({ d: 'M10 10 banana xyz', pointCount: 50 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('signature_invalid');
  });

  it('rejects path string longer than SIGNATURE_MAX_PATH_CHARS even with low pointCount', () => {
    const huge = 'M0 0 ' + 'L1 1 '.repeat(SIGNATURE_MAX_PATH_CHARS);
    const r = validateSignaturePath({ d: huge, pointCount: 50 });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('signature_too_long');
  });

describe('@fleet/driver-app - manifest-capture-policy property invariants', () => {
  it('validateCapturedFile never throws on arbitrary inputs', () => {
    fc.assert(
      fc.property(
        fc.record({
          mimeType: fc.oneof(
            fc.constantFrom('image/jpeg', 'image/png', 'image/heic', 'application/pdf', 'image/gif', 'video/mp4', ''),
            fc.string(),
          ),
          sizeBytes: fc.oneof(
            fc.integer({ min: -100, max: 100_000_000 }),
            fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
          ),
        }),
        (file) => {
          const r = validateCapturedFile(file);
          expect(typeof r.accepted).toBe('boolean');
          expect(r.policyVersion).toBe(MANIFEST_CAPTURE_POLICY_VERSION);
          return true;
        },
      ),
    );
  });

  it('any size in [MIN, MAX] with valid mime is accepted', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('image/jpeg', 'image/png', 'image/heic', 'application/pdf'),
        fc.integer({ min: MANIFEST_MIN_FILE_BYTES, max: MANIFEST_MAX_FILE_BYTES }),
        (mimeType, sizeBytes) => {
          const r = validateCapturedFile({ mimeType, sizeBytes });
          expect(r.accepted).toBe(true);
          return true;
        },
      ),
    );
  });

  it('any size below MIN is rejected as too_small (when mime is valid)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MANIFEST_MIN_FILE_BYTES - 1 }),
        (sizeBytes) => {
          const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes });
          expect(r.accepted).toBe(false);
          return true;
        },
      ),
    );
  });

  it('any size above MAX is rejected as too_large', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MANIFEST_MAX_FILE_BYTES + 1, max: MANIFEST_MAX_FILE_BYTES * 4 }),
        (sizeBytes) => {
          const r = validateCapturedFile({ mimeType: 'image/jpeg', sizeBytes });
          expect(r.accepted).toBe(false);
          return true;
        },
      ),
    );
  });

  it('validateSignaturePath never throws on arbitrary inputs', () => {
    fc.assert(
      fc.property(
        fc.record({
          d: fc.string(),
          pointCount: fc.oneof(fc.integer({ min: -10, max: 50_000 }), fc.constant(Number.NaN)),
        }),
        (sig) => {
          const r = validateSignaturePath(sig);
          expect(typeof r.accepted).toBe('boolean');
          expect(r.policyVersion).toBe(MANIFEST_CAPTURE_POLICY_VERSION);
          return true;
        },
      ),
    );
  });
});
