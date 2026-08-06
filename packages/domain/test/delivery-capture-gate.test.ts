// packages/domain/test/delivery-capture-gate.test.ts
// RED->GREEN spec for the delivery-capture phase-gate invariant.
//
// Business rule (production, 2026): a driver may photograph the single delivery
// stop (kho giao hang) ONLY after every pickup stop (kho nhan hang) already has
// a committed proof photo. Pickups themselves are order-INDEPENDENT -- the
// driver chooses the most convenient route -- so the gate is a two-phase
// partial order, NOT a strict per-sequence order: all pickups (any order) THEN
// delivery. Enforced as ONE pure domain rule consumed by both the client
// button-guard and the server commit-gate (2026 domain-invariant best practice:
// the rule lives in the model, defined once, never duplicated per surface).
//
// The gate also carries DRIVER-FACING GUIDANCE (2026 mobile-UX error-prevention
// best practice: teach the correct procedure, do not throw a blame-toned error):
//   - message: the fuller educational sentence shown on a blocked tap (Alert),
//     naming the next action and which pickups remain, in proper Vietnamese.
//   - guidanceHint: a short always-visible caption the card renders under a
//     LOCKED delivery button, so the driver is guided BEFORE tapping (prevention
//     over interruption). Both are proper Vietnamese WITH diacritics.
import { describe, it, expect } from 'vitest';
import {
  evaluateDeliveryGate,
  type DeliveryGateStop,
} from '../src/transport/delivery-capture-gate.js';

const pickup = (seq: number, name: string, hasManifest: boolean, stopType = 'pickup'): DeliveryGateStop =>
  ({ sequence: seq, stopType, warehouseName: name, hasManifest });
const delivery = (seq: number, name: string, hasManifest = false, stopType = 'delivery'): DeliveryGateStop =>
  ({ sequence: seq, stopType, warehouseName: name, hasManifest });

// A correctly-accented Vietnamese string has code units beyond ASCII (>127); an
// ASCII-stripped fallback would not. An index loop over charCodeAt avoids both a
// control-char regex (no-control-regex) and string spreading (no-misused-spread).
function hasDiacritics(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 127) return true;
  }
  return false;
}

describe('@fleet/domain - evaluateDeliveryGate: capturing a PICKUP', () => {
  it('always allows a pickup regardless of other pickups (order-independent)', () => {
    const stops = [pickup(1, 'A', false), pickup(2, 'B', false), delivery(3, 'D')];
    const r = evaluateDeliveryGate(stops, 1);
    expect(r.allowed).toBe(true);
    expect(r.blockedReason).toBeNull();
  });
  it('allows the second pickup even though the first is not yet photographed', () => {
    const stops = [pickup(1, 'A', false), pickup(2, 'B', false), delivery(3, 'D')];
    expect(evaluateDeliveryGate(stops, 2).allowed).toBe(true);
  });
  it('allows re-photographing an already-done pickup', () => {
    const stops = [pickup(1, 'A', true), pickup(2, 'B', false), delivery(3, 'D')];
    expect(evaluateDeliveryGate(stops, 1).allowed).toBe(true);
  });
  it('an allowed result carries no guidance text (empty message + hint)', () => {
    const stops = [pickup(1, 'A', false), delivery(2, 'D')];
    const r = evaluateDeliveryGate(stops, 1);
    expect(r.message).toBe('');
    expect(r.guidanceHint).toBe('');
  });
});

describe('@fleet/domain - evaluateDeliveryGate: capturing the DELIVERY', () => {
  it('BLOCKS delivery when no pickup is photographed yet', () => {
    const stops = [pickup(1, 'A', false), pickup(2, 'B', false), delivery(3, 'D')];
    const r = evaluateDeliveryGate(stops, 3);
    expect(r.allowed).toBe(false);
    expect(r.blockedReason).toBe('pickups_incomplete');
    expect(r.remainingPickupNames).toEqual(['A', 'B']);
  });
  it('BLOCKS delivery when SOME (not all) pickups are photographed', () => {
    const stops = [pickup(1, 'A', true), pickup(2, 'B', false), delivery(3, 'D')];
    const r = evaluateDeliveryGate(stops, 3);
    expect(r.allowed).toBe(false);
    expect(r.remainingPickupNames).toEqual(['B']);
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
  });
  it('ALLOWS delivery once every pickup is photographed (any order)', () => {
    const stops = [pickup(1, 'A', true), pickup(2, 'B', true), delivery(3, 'D')];
    const r = evaluateDeliveryGate(stops, 3);
    expect(r.allowed).toBe(true);
    expect(r.blockedReason).toBeNull();
    expect(r.remainingPickupNames).toEqual([]);
  });
  it('treats dropoff as delivery (raw stopType vocabulary) and gates it too', () => {
    const stops = [pickup(1, 'A', false), delivery(2, 'D', false, 'dropoff')];
    expect(evaluateDeliveryGate(stops, 2).allowed).toBe(false);
  });
  it('classifies an unknown stopType as a pickup, so it MUST be photographed before delivery (fail-safe)', () => {
    const stops = [pickup(1, 'A', true), pickup(2, 'B', false, 'transfer'), delivery(3, 'D')];
    const r = evaluateDeliveryGate(stops, 3);
    expect(r.allowed).toBe(false);
    expect(r.remainingPickupNames).toEqual(['B']);
  });
  it('names a null-warehouse remaining pickup by a stable fallback, never crashing', () => {
    const stops = [{ sequence: 1, stopType: 'pickup', warehouseName: null, hasManifest: false }, delivery(2, 'D')];
    const r = evaluateDeliveryGate(stops, 2);
    expect(r.allowed).toBe(false);
    expect(r.remainingPickupNames).toHaveLength(1);
  });
});

describe('@fleet/domain - evaluateDeliveryGate: driver-facing guidance (2026 UX: educate, do not blame)', () => {
  it('message is proper Vietnamese WITH diacritics (not an ASCII-stripped fallback)', () => {
    const stops = [pickup(1, 'Kho A', false), delivery(2, 'D')];
    const r = evaluateDeliveryGate(stops, 2);
    expect(hasDiacritics(r.message)).toBe(true);
  });
  it('message educates: names the next correct action (photograph pickups first)', () => {
    const stops = [pickup(1, 'Kho A', false), delivery(2, 'D')];
    const r = evaluateDeliveryGate(stops, 2);
    expect(r.message.toLowerCase()).toContain('kho nh');
  });
  it('message names the specific remaining pickups so the driver knows exactly where to go', () => {
    const stops = [pickup(1, 'Kho Cat Lai', true), pickup(2, 'Kho Song Than', false), delivery(3, 'D')];
    const r = evaluateDeliveryGate(stops, 3);
    expect(r.message).toContain('Kho Song Than');
    expect(r.message).not.toContain('Kho Cat Lai');
  });
  it('guidanceHint is a SHORT always-visible caption (shorter than the full message), present when blocked', () => {
    const stops = [pickup(1, 'A', false), pickup(2, 'B', false), delivery(3, 'D')];
    const r = evaluateDeliveryGate(stops, 3);
    expect(r.guidanceHint.length).toBeGreaterThan(0);
    expect(r.guidanceHint.length).toBeLessThan(r.message.length);
    expect(hasDiacritics(r.guidanceHint)).toBe(true);
  });
});

describe('@fleet/domain - evaluateDeliveryGate: degenerate shapes', () => {
  it('allows delivery when there are NO pickups at all (nothing to gate on)', () => {
    const stops = [delivery(1, 'D')];
    expect(evaluateDeliveryGate(stops, 1).allowed).toBe(true);
  });
  it('returns allowed for an unknown target sequence (never a false block)', () => {
    const stops = [pickup(1, 'A', false), delivery(2, 'D')];
    expect(evaluateDeliveryGate(stops, 99).allowed).toBe(true);
  });
});
