// packages/sync-protocol/test/dispatch-stop-net-weight-contract.test.ts
// RED for phieu-can net-weight extraction: StopProofSchema must carry an
// ADDITIVE optional+nullable extractedNetWeightKg (EXPAND-only widening).
// Old producers (no key) stay valid; new producers emit a positive kg or null.
import { describe, expect, it } from 'vitest';
import { DispatchStopViewSchema, StopProofSchema } from '../src/dispatch-stop-view-contract.js';
import { netWeightKgSchema } from '../src/dispatch-stop-view-contract.js';

const proofBase = {
  manifestId: '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d',
  photoUrl: 'https://s3.ap-southeast-1.amazonaws.com/fleet-pilot-artifacts/x.jpg',
  capturedAt: '2026-06-12T03:04:05.000Z',
};

describe('StopProofSchema extractedNetWeightKg (additive)', () => {
  it('accepts a positive numeric kg', () => {
    const r = StopProofSchema.safeParse({ ...proofBase, extractedNetWeightKg: 20730 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.extractedNetWeightKg).toBe(20730);
  });

  it('accepts null (extraction pending or failed)', () => {
    const r = StopProofSchema.safeParse({ ...proofBase, extractedNetWeightKg: null });
    expect(r.success).toBe(true);
  });

  it('still accepts proofs WITHOUT the key (old producers; EXPAND-only)', () => {
    expect(StopProofSchema.safeParse(proofBase).success).toBe(true);
  });

  it('rejects non-positive kg', () => {
    expect(StopProofSchema.safeParse({ ...proofBase, extractedNetWeightKg: 0 }).success).toBe(false);
    expect(StopProofSchema.safeParse({ ...proofBase, extractedNetWeightKg: -12 }).success).toBe(false);
  });

  it('round-trips inside DispatchStopViewSchema', () => {
    const stop = {
      stopId: '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
      sequence: 1,
      stopType: 'pickup',
      warehouseName: 'Kho A',
      arrivedAt: null,
      departedAt: null,
      proof: { ...proofBase, extractedNetWeightKg: 20730 },
    };
    expect(DispatchStopViewSchema.safeParse(stop).success).toBe(true);
  });
});


describe('netWeightKgSchema (SSOT for a Phiếu Cân net-weight value, kg)', () => {
  it('accepts a positive kg — the one type StopProofSchema + ExtractionResultWire reuse', () => {
    expect(netWeightKgSchema.safeParse(7920).success).toBe(true);
    expect(netWeightKgSchema.safeParse(0.001).success).toBe(true);
  });
  it('rejects zero, negatives, and non-finite (NaN / Infinity)', () => {
    expect(netWeightKgSchema.safeParse(0).success).toBe(false);
    expect(netWeightKgSchema.safeParse(-12).success).toBe(false);
    expect(netWeightKgSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(netWeightKgSchema.safeParse(Number.NaN).success).toBe(false);
  });
});
