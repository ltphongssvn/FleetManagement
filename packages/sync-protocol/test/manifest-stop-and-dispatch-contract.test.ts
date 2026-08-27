// packages/sync-protocol/test/manifest-stop-and-dispatch-contract.test.ts
// Mutation-killing contract tests for the proof-photo stop-association +
// dispatch read-model schemas. Accept + reject both sides of every boundary
// (.strict(), .refine(), .url(), .datetime(), unions) so Stryker can't swap them.
// The board response schemas are tolerant (strip) by design (Postel / 2026
// tolerant-reader): unknown keys are dropped, not rejected — asserted below.
//
// FIXTURES ARE FACTORIES, NOT SHARED LITERALS. Each make* function returns a
// FRESH object per call, so no test can observe or corrupt another's input.
// The previous shape was module-level const literals spread at each use site.
// Nothing mutated them, so there was no live leak -- but the read-only contract
// was unenforced, and 2026 fixture guidance is explicit that a shared object
// must be either read-only or rebuilt per test, because the failure it prevents
// is order-dependent and maddening to debug once it appears. A factory makes the
// guarantee structural rather than a convention the next author must notice.
//
// Overrides are typed as unknown-valued because these are UNTRUSTED-INPUT
// fixtures by design: several tests deliberately feed values the schema must
// reject (a non-URL photoUrl, stopType 'transfer', a negative stopCount). A
// z.infer-typed factory could not express those cases without casts.
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

type Fixture = Readonly<Record<string, unknown>>;

const makeStopRef = (overrides: Fixture = {}): Fixture => ({
  stopId: UUID,
  stopSequence: null,
  ...overrides,
});

const makeProof = (overrides: Fixture = {}): Fixture => ({
  manifestId: UUID,
  photoUrl: 'https://s3.example/p.jpg?sig=x',
  capturedAt: '2026-06-10T01:00:00.000Z',
  ...overrides,
});

/** API-authored stop view: carries stopId, .strict(). */
const makeStopView = (overrides: Fixture = {}): Fixture => ({
  stopId: UUID,
  sequence: 1,
  stopType: 'pickup',
  warehouseName: 'Kho 1',
  arrivedAt: null,
  departedAt: null,
  proof: null,
  ...overrides,
});

/** Board stop as the LOADER parses it: no stopId, tolerant (strip). */
const makeBoardStop = (overrides: Fixture = {}): Fixture => ({
  sequence: 1,
  stopType: 'pickup',
  warehouseName: 'Kho 1',
  arrivedAt: null,
  departedAt: null,
  proof: null,
  ...overrides,
});

const makeRow = (overrides: Fixture = {}): Fixture => ({
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
  cargoName: null,
  weightDiffKg: null,
  stops: [],
  ...overrides,
});

describe('ManifestStopRefSchema', () => {
  it('accepts a stopId-only ref', () => {
    expect(ManifestStopRefSchema.parse(makeStopRef())).toEqual({
      stopId: UUID,
      stopSequence: null,
    });
  });
  it('accepts a sequence-only ref', () => {
    expect(ManifestStopRefSchema.parse(makeStopRef({ stopId: null, stopSequence: 2 }))).toEqual({
      stopId: null,
      stopSequence: 2,
    });
  });
  it('rejects when BOTH are null (kills .refine() removal)', () => {
    expect(() => ManifestStopRefSchema.parse(makeStopRef({ stopId: null }))).toThrow();
  });
  it('rejects a non-positive sequence', () => {
    expect(() =>
      ManifestStopRefSchema.parse(makeStopRef({ stopId: null, stopSequence: 0 })),
    ).toThrow();
  });
  it('rejects a non-uuid stopId', () => {
    expect(() => ManifestStopRefSchema.parse(makeStopRef({ stopId: 'nope' }))).toThrow();
  });
  it('rejects extra keys (.strict())', () => {
    expect(() => ManifestStopRefSchema.parse(makeStopRef({ extra: 1 }))).toThrow();
  });
});

describe('StopProofSchema', () => {
  it('accepts a well-formed proof', () => {
    expect(StopProofSchema.parse(makeProof())).toEqual(makeProof());
  });
  it('rejects a non-URL photoUrl (kills .url() removal)', () => {
    expect(() => StopProofSchema.parse(makeProof({ photoUrl: 'not-a-url' }))).toThrow();
  });
  it('rejects a non-datetime capturedAt (kills .datetime() removal)', () => {
    expect(() => StopProofSchema.parse(makeProof({ capturedAt: 'yesterday' }))).toThrow();
  });
  it('rejects extra keys (.strict())', () => {
    expect(() => StopProofSchema.parse(makeProof({ extra: true }))).toThrow();
  });
});

describe('DispatchStopViewSchema', () => {
  it('accepts a stop with proof === null', () => {
    expect(DispatchStopViewSchema.parse(makeStopView())).toEqual(makeStopView());
  });
  it('accepts a stop with a non-null proof', () => {
    const withProof = makeStopView({ proof: makeProof() });
    expect(DispatchStopViewSchema.parse(withProof)).toEqual(withProof);
  });
  it('accepts a null warehouseName (union branch)', () => {
    expect(
      DispatchStopViewSchema.parse(makeStopView({ warehouseName: null })).warehouseName,
    ).toBeNull();
  });
  it('rejects an unknown stopType (kills enum widening)', () => {
    expect(() => DispatchStopViewSchema.parse(makeStopView({ stopType: 'transfer' }))).toThrow();
  });
  it('rejects extra keys (.strict())', () => {
    expect(() => DispatchStopViewSchema.parse(makeStopView({ extra: 1 }))).toThrow();
  });
  // CORRECTED (stop-type vocabulary arc). This previously asserted STOP_TYPES was
  // EXACTLY ['pickup','delivery'] -- pinning a two-value contract in place while
  // the production stop table has always held FOUR values (pickup, delivery,
  // dropoff, return, per SELECT DISTINCT stop_type). The assertion was not merely
  // stale: it actively DEFENDED the gap, so the mismatch could never surface as a
  // failing test. computeWeightDiffKg meanwhile matched 'delivery' by direct
  // equality and silently returned null for every dropoff-typed delivery leg.
  //
  // It now asserts the vocabulary IS the persisted reality. Order-insensitive:
  // declaration order is not a contract, membership is.
  it('exposes every PERSISTED stop type as STOP_TYPES', () => {
    expect([...STOP_TYPES].sort()).toEqual(['delivery', 'dropoff', 'pickup', 'return']);
  });
  it('accepts each persisted stop type on a real stop shape', () => {
    for (const stopType of STOP_TYPES) {
      expect(DispatchStopViewSchema.parse(makeStopView({ stopType })).stopType).toBe(stopType);
    }
  });
});

describe('DispatchBoardStopSchema (tolerant loader shape)', () => {
  it('accepts a well-formed board stop and defaults proof to null when omitted', () => {
    const { proof: _omitted, ...noProof } = makeBoardStop();
    expect(DispatchBoardStopSchema.parse(noProof).proof).toBeNull();
  });
  it('strips the API per-stop stopId (tolerant reader, not .strict())', () => {
    const parsed = DispatchBoardStopSchema.parse(makeBoardStop({ stopId: UUID }));
    expect(parsed).not.toHaveProperty('stopId');
    expect(parsed.warehouseName).toBe('Kho 1');
  });
  it('accepts a null warehouseName (union branch)', () => {
    expect(
      DispatchBoardStopSchema.parse(makeBoardStop({ warehouseName: null })).warehouseName,
    ).toBeNull();
  });
  // stopType was z.string() here until the stop-type vocabulary arc. Tolerance
  // about UNKNOWN KEYS is the Postel property this shape wants; tolerance about a
  // KNOWN FIELD'S VALUE is just an unvalidated read. Both sides asserted so the
  // distinction cannot be mutated away.
  it('accepts every persisted stop type', () => {
    for (const stopType of STOP_TYPES) {
      expect(DispatchBoardStopSchema.parse(makeBoardStop({ stopType })).stopType).toBe(stopType);
    }
  });
  it('REJECTS a stop type outside the vocabulary (kills z.string() regression)', () => {
    expect(() => DispatchBoardStopSchema.parse(makeBoardStop({ stopType: 'transfer' }))).toThrow();
  });
});

describe('DispatchBoardRowSchema', () => {
  it('accepts a well-formed board row', () => {
    expect(DispatchBoardRowSchema.parse(makeRow())).toEqual(makeRow());
  });
  it('rejects an unknown road-run state (kills enum widening)', () => {
    expect(() => DispatchBoardRowSchema.parse(makeRow({ state: 'archived' }))).toThrow();
  });
  it('rejects a non-uuid roadRunId', () => {
    expect(() => DispatchBoardRowSchema.parse(makeRow({ roadRunId: 'nope' }))).toThrow();
  });
  it('carries cargoName (Ten hang), null-defaulted when omitted (EXPAND)', () => {
    expect(DispatchBoardRowSchema.parse(makeRow({ cargoName: 'Gao' })).cargoName).toBe('Gao');
    // Omission by destructuring rather than delete: the factory output is a fresh
    // object, but building the absence declaratively keeps every fixture immutable
    // in spirit as well as in fact.
    const { cargoName: _omitted, ...noCargo } = makeRow();
    expect(DispatchBoardRowSchema.parse(noCargo).cargoName).toBeNull();
  });
  it('rejects a negative stopCount (kills .nonnegative() removal)', () => {
    expect(() => DispatchBoardRowSchema.parse(makeRow({ stopCount: -1 }))).toThrow();
  });
  it('strips unknown keys (tolerant reader, not .strict())', () => {
    const parsed = DispatchBoardRowSchema.parse(makeRow({ extra: 1 }));
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed.roadRunId).toBe(UUID);
  });
  it('applies EXPAND defaults when nullable label fields are omitted', () => {
    const minimal = {
      roadRunId: UUID,
      state: 'planned',
      assignedOperatorId: null,
      assignedAssetId: null,
      plannedStartAt: null,
      stopCount: 0,
      transportOrderRefs: [],
    };
    const parsed = DispatchBoardRowSchema.parse(minimal);
    expect(parsed.driverName).toBeNull();
    expect(parsed.vehiclePlate).toBeNull();
    expect(parsed.customerName).toBeNull();
    expect(parsed.customerPhone).toBeNull();
    expect(parsed.cargoName).toBeNull();
    expect(parsed.stops).toEqual([]);
  });
});

describe('DispatchBoardResponseSchema', () => {
  it('accepts a rows envelope', () => {
    expect(DispatchBoardResponseSchema.parse({ rows: [makeRow()] }).rows).toHaveLength(1);
  });
  it('strips unknown keys (tolerant reader, not .strict())', () => {
    const parsed = DispatchBoardResponseSchema.parse({ rows: [makeRow()], extra: 1 });
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed.rows).toHaveLength(1);
  });
});
