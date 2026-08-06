// apps/driver-app/test/card-capture-press.test.ts
// RED->GREEN: the assignment-card capture-press decision + render-time lock.
// decideCapturePress: the onPress delegate -> navigate | block (Vietnamese Alert
// title+message) when the delivery-capture gate denies the tap.
// describeCaptureLock: a render-time query (NO tap) -> { locked, hint } so the
// card can show an always-visible LOCKED delivery button with the Vietnamese
// guidanceHint BEFORE the driver taps (2026 mobile-UX error PREVENTION, not just
// reactive blocking). Both keep assignments.tsx a thin shell; the invariant +
// copy live once in @fleet/domain.
import { describe, it, expect } from 'vitest';
import { decideCapturePress, describeCaptureLock } from '../src/assignments/card-capture-press.js';
import type { StopRow } from '../src/assignments/assignments-client.js';

const stop = (sequence: number, stopType: string, hasManifest: boolean, warehouseName: string | null): StopRow => ({
  sequence, stopType, warehouseName, hasManifest, plannedAt: null, arrivedAt: null, departedAt: null,
});

// Proper Vietnamese carries code units beyond ASCII (>127). An index loop over
// charCodeAt avoids a control-char regex (no-control-regex) and string spreading
// (no-misused-spread).
function hasDiacritics(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 127) return true;
  }
  return false;
}

describe('decideCapturePress', () => {
  it('navigates when tapping a pickup (order-independent)', () => {
    const stops = [stop(1, 'pickup', false, 'A'), stop(2, 'pickup', false, 'B'), stop(3, 'delivery', false, 'D')];
    const d = decideCapturePress(stops, 1);
    expect(d.action).toBe('navigate');
  });
  it('navigates when tapping the delivery once every pickup has proof', () => {
    const stops = [stop(1, 'pickup', true, 'A'), stop(2, 'pickup', true, 'B'), stop(3, 'delivery', false, 'D')];
    expect(decideCapturePress(stops, 3).action).toBe('navigate');
  });
  it('blocks the delivery tap when a pickup lacks proof, with a Vietnamese title + message', () => {
    const stops = [stop(1, 'pickup', true, 'A'), stop(2, 'pickup', false, 'B'), stop(3, 'delivery', false, 'D')];
    const d = decideCapturePress(stops, 3);
    expect(d.action).toBe('block');
    if (d.action === 'block') {
      expect(d.alertTitle.length).toBeGreaterThan(0);
      expect(d.alertMessage).toContain('B');
    }
  });
  it('reports remaining count so the card can source the auto-advance remaining from hasManifest', () => {
    const stops = [stop(1, 'pickup', true, 'A'), stop(2, 'pickup', false, 'B'), stop(3, 'delivery', false, 'D')];
    const d = decideCapturePress(stops, 1);
    expect(d.action).toBe('navigate');
    if (d.action === 'navigate') {
      expect(d.remainingWithoutProof).toBe(1);
    }
  });
});

describe('describeCaptureLock (render-time PREVENTION: guide before the tap)', () => {
  it('reports NOT locked for a pickup stop (pickups are always capturable)', () => {
    const stops = [stop(1, 'pickup', false, 'A'), stop(2, 'delivery', false, 'D')];
    expect(describeCaptureLock(stops, 1).locked).toBe(false);
  });
  it('reports NOT locked for the delivery once every pickup has proof', () => {
    const stops = [stop(1, 'pickup', true, 'A'), stop(2, 'delivery', false, 'D')];
    expect(describeCaptureLock(stops, 2).locked).toBe(false);
  });
  it('reports LOCKED for the delivery while a pickup lacks proof, with a short Vietnamese hint', () => {
    const stops = [stop(1, 'pickup', false, 'A'), stop(2, 'delivery', false, 'D')];
    const lock = describeCaptureLock(stops, 2);
    expect(lock.locked).toBe(true);
    expect(lock.hint.length).toBeGreaterThan(0);
    expect(hasDiacritics(lock.hint)).toBe(true);
  });
  it('gives an empty hint when not locked (nothing to guide)', () => {
    const stops = [stop(1, 'pickup', false, 'A'), stop(2, 'delivery', false, 'D')];
    expect(describeCaptureLock(stops, 1).hint).toBe('');
  });
});
