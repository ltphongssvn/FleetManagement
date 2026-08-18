// packages/sync-protocol/test/list-assigned-stop-proof-contract.test.ts
// RED (contract-first): the dispatcher REVIEW row stop must carry the SAME
// Phieu Can proof the BOARD stop contract already carries, so a completed order
// whose stops hold committed photos renders the weight instead of Chua toi.
// EXPAND-only: proof is optional on the wire and DEFAULTS to null, so producers
// predating this field keep parsing (Postel / tolerant reader), mirroring
// DispatchBoardStopSchema.proof exactly rather than declaring a second shape.
import { describe, it, expect } from 'vitest';
import { ListAssignedRowStopSchema } from '../src/list-assigned-contract.js';

describe('ListAssignedRowStopSchema proof (review parity with the board)', () => {
  it('defaults proof to null when the producer omits it', () => {
    const parsed = ListAssignedRowStopSchema.parse({
      sequence: 1,
      stopType: 'pickup',
      plannedAt: null,
      warehouseName: 'Duc Tai',
      arrivedAt: null,
      departedAt: null,
    });
    expect(parsed.proof).toBeNull();
  });

  it('preserves a committed proof with its extracted net weight', () => {
    const parsed = ListAssignedRowStopSchema.parse({
      sequence: 2,
      stopType: 'delivery',
      plannedAt: null,
      warehouseName: 'Kho Giao',
      arrivedAt: null,
      departedAt: null,
      proof: {
        manifestId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        photoUrl: 'https://s3.example.com/proof.jpg?sig=abc',
        capturedAt: '2026-07-25T01:00:00.000Z',
        extractedNetWeightKg: 7920,
        extractionStatus: 'extracted',
        extractionReason: null,
      },
    });
    expect(parsed.proof).not.toBeNull();
    expect(parsed.proof?.extractedNetWeightKg).toBe(7920);
    expect(parsed.proof?.extractionStatus).toBe('extracted');
  });
});
