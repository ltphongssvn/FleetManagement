// apps/driver-app/src/assignments/card-capture-press.ts
// Pure decision helpers for the assignment-card capture button. Two concerns,
// both delegating to the shared @fleet/domain evaluateDeliveryGate rule:
//
//   decideCapturePress (on TAP) -> navigate | block:
//     - navigate: allowed; carries remainingWithoutProof so the card sources the
//       photo-implies-progress auto-advance count from hasManifest (committed-
//       proof truth), not departedAt.
//     - block: the gate denied the tap. Carries the Vietnamese Alert title +
//       educational message; the card shows Alert and does NOT navigate.
//
//   describeCaptureLock (at RENDER, no tap) -> { locked, hint }:
//     - the always-visible LOCKED-button state + short Vietnamese guidanceHint,
//       so the driver is guided to photograph pickups first BEFORE tapping
//       (2026 mobile-UX error PREVENTION over reactive interruption).
//
// The invariant AND the Vietnamese copy live once in @fleet/domain; these are
// thin UX adapters over the StopRow shape. No native deps, unit-tested directly.
import { evaluateCardCaptureGate } from './card-capture-gate.js';
import { classifyStopRole } from '@fleet/domain';
import type { StopRow } from './assignments-client.js';

// Vietnamese Alert title shown when a delivery capture is blocked (immutable
// production UI string). The body message comes from the domain rule.
const BLOCK_TITLE = 'Chưa thể chụp ảnh kho giao hàng';

export type CapturePressDecision =
  | { readonly action: 'navigate'; readonly remainingWithoutProof: number }
  | { readonly action: 'block'; readonly alertTitle: string; readonly alertMessage: string };

// Render-time lock descriptor for the capture button. locked=true means the
// gate would block a tap right now; hint is the short Vietnamese caption to show
// under the disabled button. Empty hint when not locked.
export interface CaptureLock {
  readonly locked: boolean;
  readonly hint: string;
}

// Count pickups still missing a committed photo across the whole order. This is
// the auto-advance 'remaining' the card rides on the capture href, now sourced
// from hasManifest (committed-proof truth) rather than departedAt.
function pickupsWithoutProof(stops: readonly StopRow[]): number {
  return stops.filter((s) => classifyStopRole(s.stopType) === 'pickup' && !s.hasManifest).length;
}

export function decideCapturePress(
  stops: readonly StopRow[],
  targetSequence: number,
): CapturePressDecision {
  const gate = evaluateCardCaptureGate(stops, targetSequence);
  if (!gate.allowed) {
    return { action: 'block', alertTitle: BLOCK_TITLE, alertMessage: gate.message };
  }
  return { action: 'navigate', remainingWithoutProof: pickupsWithoutProof(stops) };
}

// Render-time query: is capturing this stop currently locked, and what short
// hint should the card show? Delegates to the same gate rule so the locked
// state and the on-tap block can never disagree. The hint is the domain rule's
// guidanceHint (short, always-visible copy), distinct from the fuller Alert
// message shown only on a tap.
export function describeCaptureLock(
  stops: readonly StopRow[],
  targetSequence: number,
): CaptureLock {
  const gate = evaluateCardCaptureGate(stops, targetSequence);
  if (gate.allowed) return { locked: false, hint: '' };
  return { locked: true, hint: gate.guidanceHint };
}
