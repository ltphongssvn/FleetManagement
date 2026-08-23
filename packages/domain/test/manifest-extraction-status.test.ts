// packages/domain/test/manifest-extraction-status.test.ts
// Outside-in RED: the SSOT for a manifest's net-weight extraction status, the
// single vocabulary shared by the persistence layer, the API, and the board so
// the four UI states are distinguishable (closes the silent-failure gap):
//   pending    -> enqueued/not yet processed (default; render "processing")
//   extracted  -> VLM read a net-weight field  (render the kg)
//   not_found  -> VLM found no net-weight field (render "needs entry")
//   unreadable -> VLM read a field but parse failed (render "needs entry")
//   manual     -> a human set the kg (render the kg, flagged manual)
// The three middle values are exactly the wire EXTRACTION_STATUSES; 'pending'
// and 'manual' are persistence-only. Imported from a module that does not exist
// yet -> this suite MUST fail at import.
import { describe, it, expect } from 'vitest';
import {
  MANIFEST_EXTRACTION_STATUSES,
  manifestExtractionStatusSchema,
  isTerminalExtractionStatus,
} from '../src/manifest/manifest-extraction-status.js';

describe('manifestExtractionStatusSchema', () => {
  it('accepts every defined status', () => {
    for (const v of MANIFEST_EXTRACTION_STATUSES) {
      expect(manifestExtractionStatusSchema.parse(v)).toBe(v);
    }
  });

  it('covers exactly pending/extracted/not_found/unreadable/manual', () => {
    expect([...MANIFEST_EXTRACTION_STATUSES].sort()).toEqual([
      'extracted',
      'manual',
      'not_found',
      'pending',
      'unreadable',
    ]);
  });

  it('rejects an unknown status', () => {
    expect(manifestExtractionStatusSchema.safeParse('done').success).toBe(false);
  });

  it('treats extracted/manual as terminal-with-value', () => {
    expect(isTerminalExtractionStatus('extracted')).toBe(true);
    expect(isTerminalExtractionStatus('manual')).toBe(true);
  });

  it('treats not_found/unreadable as terminal-without-value (needs entry)', () => {
    expect(isTerminalExtractionStatus('not_found')).toBe(true);
    expect(isTerminalExtractionStatus('unreadable')).toBe(true);
  });

  it('treats pending as non-terminal (still processing)', () => {
    expect(isTerminalExtractionStatus('pending')).toBe(false);
  });
});
