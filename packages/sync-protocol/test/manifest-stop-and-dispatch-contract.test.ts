// packages/sync-protocol/test/manifest-stop-and-dispatch-contract.test.ts
// Mutation-killing contract tests for the proof-photo stop-association +
// dispatch read-model schemas. Accept + reject both sides of every boundary
// (.strict(), .refine(), .url(), .datetime(), unions) so Stryker can't swap them.
import { describe, it, expect } from 'vitest';
import {
  ManifestStopRefSchema,
  StopProofSchema,
  DispatchStopViewSchema,
  DispatchOrderViewSchema,
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
  it('exposes exactly pickup+delivery as STOP_TYPES', () => {
    expect([...STOP_TYPES]).toEqual(['pickup', 'delivery']);
  });
});

describe('DispatchOrderViewSchema', () => {
  it('accepts an order view with an array of stops', () => {
    const view = { roadRunId: UUID, orderReference: 'XTT.06-005', roadRunState: 'completed', stops: [validStop] };
    expect(DispatchOrderViewSchema.parse(view)).toEqual(view);
  });
  it('rejects an empty orderReference (.min(1))', () => {
    expect(() => DispatchOrderViewSchema.parse({ roadRunId: UUID, orderReference: '', roadRunState: 'x', stops: [] })).toThrow();
  });
  it('rejects extra keys (.strict())', () => {
    expect(() => DispatchOrderViewSchema.parse({ roadRunId: UUID, orderReference: 'X', roadRunState: 'x', stops: [], extra: 1 })).toThrow();
  });
});
