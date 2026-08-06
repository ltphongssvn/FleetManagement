// apps/driver-app/test/card-capture-gate.test.ts
// RED->GREEN: the assignment-card capture gate. Bridges the driver-app StopRow
// list to the shared @fleet/domain evaluateDeliveryGate so the card can block a
// delivery-capture tap (and show Vietnamese guidance) until every pickup stop
// has a committed photo (hasManifest). Pickups are order-independent; only the
// delivery is gated. The pure rule lives in @fleet/domain -- this is the thin
// driver-app adapter over the StopRow shape.
import { describe, it, expect } from 'vitest';
import { evaluateCardCaptureGate } from '../src/assignments/card-capture-gate.js';
import type { StopRow } from '../src/assignments/assignments-client.js';

const stop = (sequence: number, stopType: string, hasManifest: boolean, warehouseName: string | null): StopRow => ({
  sequence, stopType, warehouseName, hasManifest, plannedAt: null, arrivedAt: null, departedAt: null,
});

describe('evaluateCardCaptureGate', () => {
  it('allows capturing a pickup regardless of other pickups (order-independent)', () => {
    const stops = [stop(1, 'pickup', false, 'A'), stop(2, 'pickup', false, 'B'), stop(3, 'delivery', false, 'D')];
    expect(evaluateCardCaptureGate(stops, 1).allowed).toBe(true);
    expect(evaluateCardCaptureGate(stops, 2).allowed).toBe(true);
  });
  it('blocks the delivery when any pickup lacks a committed photo, naming the remaining pickups', () => {
    const stops = [stop(1, 'pickup', true, 'A'), stop(2, 'pickup', false, 'B'), stop(3, 'delivery', false, 'D')];
    const r = evaluateCardCaptureGate(stops, 3);
    expect(r.allowed).toBe(false);
    expect(r.remainingPickupNames).toEqual(['B']);
    expect(r.message.length).toBeGreaterThan(0);
  });
  it('allows the delivery once every pickup has a committed photo', () => {
    const stops = [stop(1, 'pickup', true, 'A'), stop(2, 'pickup', true, 'B'), stop(3, 'delivery', false, 'D')];
    expect(evaluateCardCaptureGate(stops, 3).allowed).toBe(true);
  });
  it('treats dropoff as delivery and gates it', () => {
    const stops = [stop(1, 'pickup', false, 'A'), stop(2, 'dropoff', false, 'D')];
    expect(evaluateCardCaptureGate(stops, 2).allowed).toBe(false);
  });
});
