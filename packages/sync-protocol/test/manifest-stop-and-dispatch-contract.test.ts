// packages/sync-protocol/test/manifest-stop-and-dispatch-contract.test.ts
// Mutation-killing contract tests for the proof-photo stop-association +
// dispatch read-model schemas. Accept + reject both sides of every boundary
// (.strict(), .refine(), .url(), .datetime(), unions) so Stryker can't swap them.
// The board response schemas are tolerant (strip) by design (Postel / 2026
// tolerant-reader): unknown keys are dropped, not rejected — asserted below.
import { describe, it, expect } from 'vitest';
import {
  ManifestStopRefSchema,
  StopProofSchema,
  DispatchStopViewSchema,
  DispatchBoardStopSchema,
  DispatchBoardRowSchema,
  DispatchBoardResponseSchema,
  STOP_TYPES,
} from '../src/index.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('ManifestStopRefSchema', () => {
  it('accepts a stopId-only ref', () => {
    expect(ManifestStopRefSchema.parse({ stopId: UUID, stopSequence: null })).toEqual({ stopId: UUID, stopSequence: null });
  });
  it('accepts a sequence-only ref', () => {
    expect(ManifestStopRefSchema.parse({ stopId: null, stopSequence: 2 })).toEqual({ stopId: null, stopSequence: 2 });
  });
  it('rejects when BOTH are null (kills .refine() removal)', () => {
    expect(() => ManifestStopRefSchema.parse({ stopId: null, stopSequence: null })).toThrow();
  });
  it('rejects a non-positive sequence', () => {
    expect(() => ManifestStopRefSchema.parse({ stopId: null, stopSequence: 0 })).toThrow();
  });
  it('rejects a non-uuid stopId', () => {
    expect(() => ManifestStopRefSchema.parse({ stopId: 'nope', stopSequence: null })).toThrow();
  });
  it('rejects extra keys (.strict())', () => {
    expect(() => ManifestStopRefSchema.parse({ stopId: UUID, stopSequence: null, extra: 1 })).toThrow();
  });
});

const validProof = { manifestId: UUID, photoUrl: 'https://s3.example/p.jpg?sig=x', capturedAt: '2026-06-10T01:00:00.000Z' };

describe('StopProofSchema', () => {
  it('accepts a well-formed proof', () => {
    expect(StopProofSchema.parse(validProof)).toEqual(validProof);
  });
  it('rejects a non-URL photoUrl (kills .url() removal)', () => {
    expect(() => StopProofSchema.parse({ ...validProof, photoUrl: 'not-a-url' })).toThrow();
  });
  it('rejects a non-datetime capturedAt (kills .datetime() removal)', () => {
    expect(() => StopProofSchema.parse({ ...validProof, capturedAt: 'yesterday' })).toThrow();
  });
  it('rejects extra keys (.strict())', () => {
    expect(() => StopProofSchema.parse({ ...validProof, extra: true })).toThrow();
  });
});

const validStop = { stopId: UUID, sequence: 1, stopType: 'pickup', warehouseName: 'Kho 1', arrivedAt: null, departedAt: null, proof: null };

describe('DispatchStopViewSchema', () => {
  it('accepts a stop with proof === null', () => {
    expect(DispatchStopViewSchema.parse(validStop)).toEqual(validStop);
  });
  it('accepts a stop with a non-null proof', () => {
    const withProof = { ...validStop, proof: validProof };
    expect(DispatchStopViewSchema.parse(withProof)).toEqual(withProof);
  });
  it('accepts a null warehouseName (union branch)', () => {
    expect(DispatchStopViewSchema.parse({ ...validStop, warehouseName: null }).warehouseName).toBeNull();
  });
  it('rejects an unknown stopType (kills enum widening)', () => {
    expect(() => DispatchStopViewSchema.parse({ ...validStop, stopType: 'transfer' })).toThrow();
  });
  it('rejects extra keys (.strict())', () => {
    expect(() => DispatchStopViewSchema.parse({ ...validStop, extra: 1 })).toThrow();
  });
  it('exposes exactly pickup+delivery as STOP_TYPES', () => {
    expect([...STOP_TYPES]).toEqual(['pickup', 'delivery']);
  });
});

// Canonical board stop as the loader PARSES it: tolerant (strip). It carries NO
// stopId field, and the API's per-stop stopId is silently dropped rather than
// rejected — preserving the former non-strict loader behaviour (Postel).
const validBoardStop = { sequence: 1, stopType: 'pickup', warehouseName: 'Kho 1', arrivedAt: null, departedAt: null, proof: null };

describe('DispatchBoardStopSchema (tolerant loader shape)', () => {
  it('accepts a well-formed board stop and defaults proof to null when omitted', () => {
    const parsed = DispatchBoardStopSchema.parse({ sequence: 1, stopType: 'pickup', warehouseName: 'Kho 1', arrivedAt: null, departedAt: null });
    expect(parsed.proof).toBeNull();
  });
  it('strips the API per-stop stopId (tolerant reader, not .strict())', () => {
    const parsed = DispatchBoardStopSchema.parse({ ...validBoardStop, stopId: UUID });
    expect(parsed).not.toHaveProperty('stopId');
    expect(parsed.warehouseName).toBe('Kho 1');
  });
  it('accepts a null warehouseName (union branch)', () => {
    expect(DispatchBoardStopSchema.parse({ ...validBoardStop, warehouseName: null }).warehouseName).toBeNull();
  });
});

// Canonical board row (replaces the former divergent order-view schema, which was
// missing the fields actually on the wire). Real GET /dispatch/board row:
// tolerant (strip), enum state, EXPAND-only nullable + .default() carry-overs.
const validRow = {
  roadRunId: UUID,
  state: 'completed',
  assignedOperatorId: null,
  assignedAssetId: null,
  driverName: null,
  vehiclePlate: null,
  plannedStartAt: null,
  stopCount: 0,
  transportOrderRefs: ['XTT.06-005'],
  customerName: null,
  customerPhone: null,
  weightDiffKg: null,
  stops: [],
};

describe('DispatchBoardRowSchema', () => {
  it('accepts a well-formed board row', () => {
    expect(DispatchBoardRowSchema.parse(validRow)).toEqual(validRow);
  });
  it('rejects an unknown road-run state (kills enum widening)', () => {
    expect(() => DispatchBoardRowSchema.parse({ ...validRow, state: 'archived' })).toThrow();
  });
  it('rejects a non-uuid roadRunId', () => {
    expect(() => DispatchBoardRowSchema.parse({ ...validRow, roadRunId: 'nope' })).toThrow();
  });
  it('rejects a negative stopCount (kills .nonnegative() removal)', () => {
    expect(() => DispatchBoardRowSchema.parse({ ...validRow, stopCount: -1 })).toThrow();
  });
  it('strips unknown keys (tolerant reader, not .strict())', () => {
    const parsed = DispatchBoardRowSchema.parse({ ...validRow, extra: 1 });
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed.roadRunId).toBe(UUID);
  });
  it('applies EXPAND defaults when nullable label fields are omitted', () => {
    const minimal = { roadRunId: UUID, state: 'planned', assignedOperatorId: null, assignedAssetId: null, plannedStartAt: null, stopCount: 0, transportOrderRefs: [] };
    const parsed = DispatchBoardRowSchema.parse(minimal);
    expect(parsed.driverName).toBeNull();
    expect(parsed.vehiclePlate).toBeNull();
    expect(parsed.customerName).toBeNull();
    expect(parsed.customerPhone).toBeNull();
    expect(parsed.stops).toEqual([]);
  });
});

describe('DispatchBoardResponseSchema', () => {
  it('accepts a rows envelope', () => {
    expect(DispatchBoardResponseSchema.parse({ rows: [validRow] }).rows).toHaveLength(1);
  });
  it('strips unknown keys (tolerant reader, not .strict())', () => {
    const parsed = DispatchBoardResponseSchema.parse({ rows: [validRow], extra: 1 });
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed.rows).toHaveLength(1);
  });
});
