// packages/sync-protocol/test/reference-contract.test.ts
// RED-first (schema-first arc): SSOT for the /reference/* wire contract.
// The same shape is hand-written FOUR times today (api ReferenceItem +
// ReferenceListResponse, ops-web ReferenceOption, ops-web RefItem -- the
// last already drifted: meta lost) and cast-not-parsed at five consumer
// sites. One schema here; every site derives via z.infer. Consumption is
// must-ignore forward-compatible: z.object strips unknown keys on parse,
// so producers can extend without breaking readers (the t5b lesson:
// consumers trusting an un-parsed shape discover producer migrations as
// production e2e failures instead of unit-level parse errors).
//
// SEGMENT VOCABULARY (this RED): ReferenceSegment is hand-written as a bare
// TS union in ops-web reference-admin-client, but it is NOT internal -- each
// member IS the URL path segment the api binds (@Get(cargo-types), @Post(
// vehicles), ...). It crosses the ops-web -> BFF -> api boundary, so it is a
// contract vocabulary and belongs here under the canonical frozen as-const
// -> z.enum -> z.infer pattern. A bare union cannot validate an untrusted
// segment (a BFF route param) and cannot be iterated to drive the sections.
import { describe, it, expect } from 'vitest';
import {
  ReferenceItemSchema,
  ReferenceListResponseSchema,
  DriverVehicleAssignmentItemSchema,
  DriverVehicleAssignmentsResponseSchema,
  PeekOrderRefResponseSchema,
  REFERENCE_SEGMENTS,
  ReferenceSegmentSchema,
  type ReferenceItem,
  type ReferenceSegment,
} from '../src/reference-contract.js';
describe('reference wire contract', () => {
  it('parses a minimal item (id + label) and one with the meta bag', () => {
    expect(ReferenceItemSchema.parse({ id: 'c1', label: 'Acme' })).toEqual({ id: 'c1', label: 'Acme' });
    const withMeta = ReferenceItemSchema.parse({ id: 'c2', label: 'Kho A', meta: { phone: '0901', note: null } });
    expect(withMeta.meta).toEqual({ phone: '0901', note: null });
  });
  it('rejects items missing id or label, and empty ids', () => {
    expect(ReferenceItemSchema.safeParse({ label: 'x' }).success).toBe(false);
    expect(ReferenceItemSchema.safeParse({ id: 'c1' }).success).toBe(false);
    expect(ReferenceItemSchema.safeParse({ id: '', label: 'x' }).success).toBe(false);
    expect(ReferenceItemSchema.safeParse({ id: 1, label: 'x' }).success).toBe(false);
  });
  it('strips unknown keys (must-ignore forward compatibility)', () => {
    const parsed = ReferenceItemSchema.parse({ id: 'c1', label: 'Acme', futureField: 42 });
    expect('futureField' in parsed).toBe(false);
  });
  it('parses the list envelope and requires items', () => {
    const ok = ReferenceListResponseSchema.parse({ items: [{ id: 'c1', label: 'Acme' }] });
    expect(ok.items).toHaveLength(1);
    expect(ReferenceListResponseSchema.safeParse({}).success).toBe(false);
    expect(ReferenceListResponseSchema.safeParse({ items: [{ id: 1 }] }).success).toBe(false);
  });
  it('parses the driver-vehicle assignment envelope', () => {
    expect(DriverVehicleAssignmentItemSchema.parse({ operatorId: 'o1', vehicleId: 'v1' }))
      .toEqual({ operatorId: 'o1', vehicleId: 'v1' });
    const ok = DriverVehicleAssignmentsResponseSchema.parse({ items: [{ operatorId: 'o1', vehicleId: 'v1' }] });
    expect(ok.items).toHaveLength(1);
    expect(DriverVehicleAssignmentsResponseSchema.safeParse({ items: [{ operatorId: 'o1' }] }).success).toBe(false);
  });
  it('parses the peek-order-ref envelope', () => {
    expect(PeekOrderRefResponseSchema.parse({ ref: 'XTT.07-001' })).toEqual({ ref: 'XTT.07-001' });
    expect(PeekOrderRefResponseSchema.safeParse({}).success).toBe(false);
  });
  it('derives the item type via z.infer (compile-time SSOT proof)', () => {
    const item: ReferenceItem = { id: 'c1', label: 'Acme', meta: { phone: null } };
    expect(item.id).toBe('c1');
  });
});
describe('reference segment vocabulary (SSOT)', () => {
  it('exposes the canonical segments, frozen and in api-route order', () => {
    expect(REFERENCE_SEGMENTS).toEqual(['customers', 'cargo-types', 'vehicles', 'warehouses']);
    expect(Object.isFrozen(REFERENCE_SEGMENTS)).toBe(true);
  });
  it('accepts every canonical segment', () => {
    for (const seg of REFERENCE_SEGMENTS) {
      expect(ReferenceSegmentSchema.parse(seg)).toBe(seg);
    }
  });
  it('rejects unknown, empty, and non-string segments', () => {
    expect(ReferenceSegmentSchema.safeParse('drivers').success).toBe(false);
    expect(ReferenceSegmentSchema.safeParse('cargo_types').success).toBe(false);
    expect(ReferenceSegmentSchema.safeParse('').success).toBe(false);
    expect(ReferenceSegmentSchema.safeParse(1).success).toBe(false);
    expect(ReferenceSegmentSchema.safeParse(null).success).toBe(false);
  });
  it('narrows to the derived type (compile-time SSOT proof)', () => {
    const seg: ReferenceSegment = 'cargo-types';
    expect(REFERENCE_SEGMENTS.includes(seg)).toBe(true);
  });
});
