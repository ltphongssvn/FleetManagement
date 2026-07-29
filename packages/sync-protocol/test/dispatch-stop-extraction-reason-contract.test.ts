// packages/sync-protocol/test/dispatch-stop-extraction-reason-contract.test.ts
// Outside-in RED (board review-queue, read contract): StopProofSchema must carry
// an ADDITIVE optional extractionReason so the board can show WHY an extraction
// failed (unparseable vs object_missing vs ...) — the signal a dispatcher review
// queue needs, not just the bare 'unreadable' status. Vocabulary is the SSOT
// @fleet/sync-protocol EXTRACTION_FAILURE_REASONS. EXPAND-only: old producers
// omitting the key stay valid; null for pending/extracted/manual. RED: no key yet.
import { describe, expect, it } from 'vitest';
import { DispatchStopViewSchema, StopProofSchema } from '../src/dispatch-stop-view-contract.js';
const proofBase = {
  manifestId: '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d',
  photoUrl: 'https://s3.ap-southeast-1.amazonaws.com/fleet-pilot-artifacts/x.jpg',
  capturedAt: '2026-06-15T03:04:05.000Z',
};

describe('StopProofSchema extractionReason (additive)', () => {
  it('accepts each valid failure reason', () => {
    for (const reason of ['unparseable', 'below_sanity_min', 'above_sanity_max', 'no_field', 'object_missing']) {
      const r = StopProofSchema.safeParse({ ...proofBase, extractionStatus: 'unreadable', extractionReason: reason });
      expect(r.success).toBe(true);
    }
  });

  it('accepts null reason (pending/extracted/manual rows have none)', () => {
    expect(StopProofSchema.safeParse({ ...proofBase, extractionStatus: 'extracted', extractionReason: null }).success).toBe(true);
  });

  it('still accepts proofs WITHOUT the key (old producers; EXPAND-only)', () => {
    expect(StopProofSchema.safeParse(proofBase).success).toBe(true);
  });

  it('accepts the T33 cannot-recognize reasons (multiple_slips, non_standard_format)', () => {
    for (const reason of ['multiple_slips', 'non_standard_format']) {
      const r = StopProofSchema.safeParse({ ...proofBase, extractionStatus: 'not_found', extractionReason: reason });
      expect(r.success).toBe(true);
    }
  });

  it('rejects an unknown reason', () => {
    expect(StopProofSchema.safeParse({ ...proofBase, extractionReason: 'bogus' }).success).toBe(false);
  });

  it('round-trips status + reason inside DispatchStopViewSchema', () => {
    const stop = {
      stopId: '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
      sequence: 1,
      stopType: 'pickup',
      warehouseName: 'Kho A',
      arrivedAt: null,
      departedAt: null,
      proof: { ...proofBase, extractedNetWeightKg: null, extractionStatus: 'unreadable', extractionReason: 'unparseable' },
    };
    expect(DispatchStopViewSchema.safeParse(stop).success).toBe(true);
  });
});
