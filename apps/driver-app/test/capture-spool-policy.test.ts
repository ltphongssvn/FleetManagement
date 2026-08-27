// apps/driver-app/test/capture-spool-policy.test.ts
import { describe, it, expect } from 'vitest';
import {
  createSpoolEntry,
  defaultGenerateId,
  classifyForRecovery,
  sweepSpool,
  CAPTURE_SPOOL_POLICY_VERSION,
  SPOOL_ENTRY_TTL_MS,
  SPOOL_ENTRY_MIN_AGE_MS,
  SPOOL_MAX_ATTEMPTS,
  type SpoolEntry,
  type SpoolDeps,
} from '../src/manifest/capture-spool-policy.js';

function makeEntry(overrides: Partial<SpoolEntry> = {}): SpoolEntry {
  return {
    captureId: '01900000-0000-7000-8000-000000000000',
    manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
    localUri: 'file:///tmp/x.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1_500_000,
    status: 'pending_upload',
    createdAtMs: 1_700_000_000_000,
    attempts: 0,
    ...overrides,
  };
}

const BASE_NOW = 1_700_000_000_000;

describe('@fleet/driver-app - createSpoolEntry', () => {
  it('returns entry with UUIDv7 captureId, pending_upload status, zero attempts', () => {
    const deps: SpoolDeps = {
      now: () => 1_700_000_000_000,
      generateId: (n: number) => `t${String(n)}-uuid`,
    };
    const entry = createSpoolEntry(
      {
        manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
        localUri: 'file:///x.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1_000,
      },
      deps,
    );
    expect(entry.status).toBe('pending_upload');
    expect(entry.attempts).toBe(0);
    expect(entry.createdAtMs).toBe(1_700_000_000_000);
    expect(entry.captureId).toBe('t1700000000000-uuid');
  });

  it('uses real UUIDv7 by default (no deps injected)', () => {
    const entry = createSpoolEntry({
      manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
      localUri: 'f',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
    });
    expect(entry.captureId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('captureIds advance deterministically when deps.generateId returns sortable strings', () => {
    let counter = 0;
    const deps: SpoolDeps = {
      now: () => 1_700_000_000_000 + counter++,
      generateId: (n: number) => `${String(n).padStart(15, '0')}-uuid`,
    };
    const a = createSpoolEntry(
      {
        manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
        localUri: 'f',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
      },
      deps,
    );
    const b = createSpoolEntry(
      {
        manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
        localUri: 'f',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
      },
      deps,
    );
    expect(a.captureId < b.captureId).toBe(true);
  });
});

describe('@fleet/driver-app - classifyForRecovery', () => {
  it('cleans up already-uploaded entries', () => {
    const r = classifyForRecovery(makeEntry({ status: 'uploaded' }), BASE_NOW + 1000);
    expect(r.action).toBe('cleanup');
    if (r.action === 'cleanup') expect(r.reason).toBe('already_uploaded');
  });

  it('resumes uploading entries within TTL (crash recovery)', () => {
    const r = classifyForRecovery(makeEntry({ status: 'uploading' }), BASE_NOW + 30_000);
    expect(r.action).toBe('resume_upload');
  });

  it('skips entries still in capture-in-progress window', () => {
    const r = classifyForRecovery(makeEntry(), BASE_NOW + SPOOL_ENTRY_MIN_AGE_MS - 1);
    expect(r.action).toBe('skip_in_progress');
  });

  it('abandons entries older than TTL', () => {
    const r = classifyForRecovery(makeEntry(), BASE_NOW + SPOOL_ENTRY_TTL_MS + 1);
    expect(r.action).toBe('abandon');
    if (r.action === 'abandon') expect(r.reason).toBe('ttl_exceeded');
  });

  it('abandons entries with too many attempts', () => {
    const r = classifyForRecovery(makeEntry({ attempts: SPOOL_MAX_ATTEMPTS }), BASE_NOW + 10_000);
    expect(r.action).toBe('abandon');
    if (r.action === 'abandon') expect(r.reason).toBe('too_many_attempts');
  });

  it('resumes pending entries past min-age but within TTL', () => {
    const r = classifyForRecovery(makeEntry(), BASE_NOW + 60_000);
    expect(r.action).toBe('resume_upload');
  });

  it('TTL takes precedence over too_many_attempts', () => {
    const r = classifyForRecovery(makeEntry({ attempts: 99 }), BASE_NOW + SPOOL_ENTRY_TTL_MS + 1);
    expect(r.action).toBe('abandon');
    if (r.action === 'abandon') expect(r.reason).toBe('ttl_exceeded');
  });

  it('resumes failed entries within TTL and attempts limit', () => {
    const r = classifyForRecovery(makeEntry({ status: 'failed', attempts: 2 }), BASE_NOW + 60_000);
    expect(r.action).toBe('resume_upload');
  });
});

describe('@fleet/driver-app - sweepSpool', () => {
  it('returns one decision per entry, preserving order', () => {
    const e1 = makeEntry({ captureId: 'e1', createdAtMs: 1000 });
    const e2 = makeEntry({ captureId: 'e2', status: 'uploaded', createdAtMs: 2000 });
    const decisions = sweepSpool([e1, e2], 60_000);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]?.entry.captureId).toBe('e1');
    expect(decisions[1]?.entry.captureId).toBe('e2');
    expect(decisions[1]?.classification.action).toBe('cleanup');
  });

  it('returns empty array on empty input', () => {
    expect(sweepSpool([], Date.now())).toEqual([]);
  });
});

describe('@fleet/driver-app - capture-spool-policy stable identifiers', () => {
  it('exports policy version, TTL, and max-attempts constants', () => {
    expect(CAPTURE_SPOOL_POLICY_VERSION).toBe('capture-spool-v1');
    expect(SPOOL_ENTRY_TTL_MS).toBe(60 * 60 * 1000);
    expect(SPOOL_ENTRY_MIN_AGE_MS).toBe(5_000);
    expect(SPOOL_MAX_ATTEMPTS).toBe(5);
  });
});

import fc from 'fast-check';

describe('@fleet/driver-app - capture-spool-policy property invariants', () => {
  it('classifyForRecovery never throws on arbitrary entries + nowMs', () => {
    fc.assert(
      fc.property(
        fc.record({
          captureId: fc.string({ minLength: 1, maxLength: 50 }),
          manifestCorrelationId: fc.string({ minLength: 1, maxLength: 50 }),
          localUri: fc.string(),
          mimeType: fc.constantFrom('image/jpeg', 'image/png', 'application/pdf', 'image/heic'),
          sizeBytes: fc.integer({ min: 0, max: 100_000_000 }),
          status: fc.constantFrom('pending_upload', 'uploading', 'uploaded', 'failed' as const),
          createdAtMs: fc.integer({ min: 0, max: 10_000_000_000_000 }),
          attempts: fc.integer({ min: 0, max: 50 }),
        }),
        fc.integer({ min: 0, max: 10_000_000_000_000 }),
        (entry, nowMs) => {
          const r = classifyForRecovery(entry, nowMs);
          expect(['cleanup', 'abandon', 'resume_upload', 'skip_in_progress']).toContain(r.action);
          return true;
        },
      ),
    );
  });

  it('uploaded status always classifies as cleanup regardless of age/attempts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000_000_000 }),
        fc.integer({ min: 0, max: 50 }),
        (ageOffsetMs, attempts) => {
          const entry: SpoolEntry = {
            captureId: 'x',
            manifestCorrelationId: 'y',
            localUri: 'f',
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            status: 'uploaded',
            createdAtMs: 1_000_000,
            attempts,
          };
          const r = classifyForRecovery(entry, 1_000_000 + ageOffsetMs);
          expect(r.action).toBe('cleanup');
          return true;
        },
      ),
    );
  });

  it('age >= TTL always abandons (regardless of status pending/failed/uploading)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('pending_upload', 'failed' as const),
        fc.integer({ min: 0, max: 50 }),
        (status, attempts) => {
          const entry: SpoolEntry = {
            captureId: 'x',
            manifestCorrelationId: 'y',
            localUri: 'f',
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            status,
            createdAtMs: 1_000_000,
            attempts,
          };
          const r = classifyForRecovery(entry, 1_000_000 + SPOOL_ENTRY_TTL_MS + 1);
          expect(r.action).toBe('abandon');
          return true;
        },
      ),
    );
  });
});

describe('@fleet/driver-app - capture-spool-policy precedence + boundaries', () => {
  it('passes nowMs to generateId so captureId timestamp matches createdAtMs (#386)', () => {
    const calls: number[] = [];
    const deps: SpoolDeps = {
      now: () => 1_700_000_000_500,
      generateId: (n: number) => {
        calls.push(n);
        return `seeded-${String(n)}`;
      },
    };
    const entry = createSpoolEntry(
      {
        manifestCorrelationId: 'm',
        localUri: 'f',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
      },
      deps,
    );
    expect(calls).toEqual([1_700_000_000_500]);
    expect(entry.createdAtMs).toBe(1_700_000_000_500);
    expect(entry.captureId).toBe('seeded-1700000000500');
  });

  it('skips future-dated entries (clock skew, #390) instead of stuck loop', () => {
    const r = classifyForRecovery(makeEntry({ createdAtMs: BASE_NOW + 60_000 }), BASE_NOW);
    expect(r.action).toBe('skip_in_progress');
  });

  it('abandons uploading entries past attempts cap even within TTL (#392)', () => {
    const r = classifyForRecovery(
      makeEntry({ status: 'uploading', attempts: SPOOL_MAX_ATTEMPTS, createdAtMs: BASE_NOW }),
      BASE_NOW + 30_000,
    );
    expect(r.action).toBe('abandon');
    if (r.action === 'abandon') expect(r.reason).toBe('too_many_attempts');
  });

  it('resumes failed entries even within min-age window (#391: min-age applies only to pending_upload)', () => {
    const r = classifyForRecovery(
      makeEntry({ status: 'failed', createdAtMs: BASE_NOW }),
      BASE_NOW + 1_000,
    );
    expect(r.action).toBe('resume_upload');
  });

  it('skips pending_upload entries within min-age window (#391)', () => {
    const r = classifyForRecovery(
      makeEntry({ status: 'pending_upload', createdAtMs: BASE_NOW }),
      BASE_NOW + SPOOL_ENTRY_MIN_AGE_MS - 1,
    );
    expect(r.action).toBe('skip_in_progress');
  });

  it('resumes at exact min-age boundary (#397)', () => {
    const r = classifyForRecovery(
      makeEntry({ status: 'pending_upload', createdAtMs: BASE_NOW }),
      BASE_NOW + SPOOL_ENTRY_MIN_AGE_MS,
    );
    expect(r.action).toBe('resume_upload');
  });

  it('abandons at exact TTL boundary (#397)', () => {
    const r = classifyForRecovery(
      makeEntry({ status: 'pending_upload', createdAtMs: BASE_NOW }),
      BASE_NOW + SPOOL_ENTRY_TTL_MS,
    );
    expect(r.action).toBe('abandon');
    if (r.action === 'abandon') expect(r.reason).toBe('ttl_exceeded');
  });

  it('resumes at attempts cap minus one (#397)', () => {
    const r = classifyForRecovery(
      makeEntry({
        status: 'pending_upload',
        attempts: SPOOL_MAX_ATTEMPTS - 1,
        createdAtMs: BASE_NOW,
      }),
      BASE_NOW + 60_000,
    );
    expect(r.action).toBe('resume_upload');
  });

  it('abandons at exact attempts cap (#397)', () => {
    const r = classifyForRecovery(
      makeEntry({ status: 'pending_upload', attempts: SPOOL_MAX_ATTEMPTS, createdAtMs: BASE_NOW }),
      BASE_NOW + 60_000,
    );
    expect(r.action).toBe('abandon');
    if (r.action === 'abandon') expect(r.reason).toBe('too_many_attempts');
  });
});

describe('@fleet/driver-app - capture-spool-policy mutation-hardening', () => {
  it('defaultGenerateId encodes the provided nowMs in the UUIDv7 timestamp prefix (kills L19 uuidv7({msecs:nowMs}) -> uuidv7({}) mutant)', () => {
    // UUIDv7 spec: bits 0-47 are unix_ts_ms. The first 12 hex chars (with dashes removed)
    // are the ms timestamp. The default generateId calls uuidv7({ msecs: nowMs }).
    // Mutated `uuidv7({})` uses current Date.now() instead of the injected nowMs.
    // Discriminating: inject nowMs far in the past — the encoded timestamp must match
    // the injected value exactly, not wall-clock time.
    const pastMs = 1_700_000_000_500; // ~Nov 2023; far from any test wall-clock.
    const id = defaultGenerateId(pastMs);
    const hex = id.replace(/-/g, '').substring(0, 12);
    const tsMs = parseInt(hex, 16);
    expect(tsMs).toBe(pastMs);
  });

  it('createSpoolEntry with omitted deps uses real Date.now (kills L22 REAL_DEPS.now arrow -> () => undefined mutant)', () => {
    // Calling createSpoolEntry({...}) without `deps` uses REAL_DEPS. If REAL_DEPS.now were
    // mutated to () => undefined, the UUIDv7 timestamp would be NaN/undefined, breaking the
    // captureId format. Original produces a valid UUIDv7 whose timestamp is roughly Date.now().
    const before = Date.now();
    const entry = createSpoolEntry({
      manifestCorrelationId: 'm',
      localUri: 'f',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
    });
    const after = Date.now();
    // createdAtMs from REAL_DEPS.now() must be a real number in [before, after]
    expect(typeof entry.createdAtMs).toBe('number');
    expect(Number.isFinite(entry.createdAtMs)).toBe(true);
    expect(entry.createdAtMs).toBeGreaterThanOrEqual(before);
    expect(entry.createdAtMs).toBeLessThanOrEqual(after);
    // captureId must be a valid UUIDv7 string
    expect(entry.captureId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('classifyForRecovery on future-dated failed entry returns skip_in_progress, not resume_upload (kills L100 < 0 -> false / block-empty mutants)', () => {
    // Original L100: ageMs < 0 → returns skip_in_progress regardless of other status checks.
    // Mutated L100 -> if (false): skips, falls through. Status 'failed' is not 'uploaded', not 'uploading',
    // not 'pending_upload' → reaches L119 → returns resume_upload. DIFFERENT.
    // Mutated L100 -> if (ageMs < 0) {}: enters but no return, falls through, same as above.
    const entry = makeEntry({ status: 'failed' });
    const nowMsInFuture = BASE_NOW - 10_000; // entry is 10s in the future
    const r = classifyForRecovery(entry, nowMsInFuture);
    expect(r.action).toBe('skip_in_progress');
  });

  it('classifyForRecovery at exact ageMs=0 with failed status returns resume_upload (kills L100 < -> <= mutant)', () => {
    // ageMs = 0 (now exactly equals createdAtMs).
    // Original L100: `0 < 0` is false → not skip. Status 'failed' falls through to L119 → resume_upload.
    // Mutated L100: `0 <= 0` is true → returns skip_in_progress. DIFFERENT.
    const entry = makeEntry({ status: 'failed' });
    const r = classifyForRecovery(entry, BASE_NOW);
    expect(r.action).toBe('resume_upload');
  });
});
