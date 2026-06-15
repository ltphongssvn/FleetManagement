// packages/sync-protocol/test/dispatch-stop-extraction-status-contract.test.ts
// Outside-in RED (gap 2, read contract): StopProofSchema must carry an ADDITIVE
// optional extractionStatus so the board can render the four UI states —
// pending ("processing"), not_found/unreadable ("needs entry"), extracted/manual
// (show kg). Vocabulary is the @fleet/domain SSOT. EXPAND-only: old producers
// omitting the key stay valid. This field does not exist yet -> RED.
import { describe, expect, it } from 'vitest';
import { DispatchStopViewSchema, StopProofSchema } from '../src/dispatch-stop-view-contract.js';
const proofBase = {
  manifestId: '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d',
  photoUrl: 'https://s3.ap-southeast-1.amazonaws.com/fleet-pilot-artifacts/x.jpg',
  capturedAt: '2026-06-15T03:04:05.000Z',
};

describe('StopProofSchema extractionStatus (additive)', () => {
  it('accepts each valid status', () => {
    for (const status of ['pending', 'extracted', 'not_found', 'unreadable', 'manual']) {
      const r = StopProofSchema.safeParse({ ...proofBase, extractionStatus: status });
      expect(r.success).toBe(true);
    }
  });

  it('still accepts proofs WITHOUT the key (old producers; EXPAND-only)', () => {
    expect(StopProofSchema.safeParse(proofBase).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(StopProofSchema.safeParse({ ...proofBase, extractionStatus: 'done' }).success).toBe(false);
  });

  it('round-trips status + kg inside DispatchStopViewSchema', () => {
    const stop = {
      stopId: '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
      sequence: 1,
      stopType: 'pickup',
      warehouseName: 'Kho A',
      arrivedAt: null,
      departedAt: null,
      proof: { ...proofBase, extractedNetWeightKg: 42130, extractionStatus: 'manual' },
    };
    expect(DispatchStopViewSchema.safeParse(stop).success).toBe(true);
  });
});
