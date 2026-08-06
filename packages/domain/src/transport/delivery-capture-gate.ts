// packages/domain/src/transport/delivery-capture-gate.ts
// The delivery-capture phase-gate invariant, as ONE pure domain rule.
//
// Business rule (production, 2026): a driver may photograph the single delivery
// stop (kho giao hàng) ONLY after every pickup stop (kho nhận hàng) already
// carries a committed proof photo. Pickups are order-INDEPENDENT among
// themselves -- the driver picks the most convenient route -- so this is a
// TWO-PHASE PARTIAL ORDER (all pickups in any order, THEN delivery), never a
// strict per-sequence order.
//
// This function is the single enforcement point, consumed by BOTH the driver-app
// capture button-guard (UX: block + guidance) and the server-side commit gate
// (authoritative reject). 2026 domain-invariant best practice: define the rule
// in the model once; do not re-derive it per surface.
//
// Driver-facing guidance (2026 mobile-UX error-prevention best practice: teach
// the correct procedure, never throw a blame-toned error). The rule owns the
// Vietnamese copy so every surface speaks identically:
//   - message: the fuller educational sentence shown on a blocked tap. Explains
//     WHY (delivery unlocks after pickups) and names WHICH pickups remain.
//   - guidanceHint: a short always-visible caption the card renders under the
//     LOCKED delivery button, guiding the driver BEFORE they tap (prevention
//     over interruption). Both are proper Vietnamese WITH diacritics.
//
// Role classification derives from the STOP_ROLES SSOT (classifyStopRole), which
// folds the raw persisted stopType vocabulary (pickup | delivery | dropoff,
// mixed case) into two canonical roles. Unknown stopTypes classify as pickup --
// a fail-safe: an unclassifiable stop still must be photographed before delivery
// unlocks, so the gate can never be bypassed by a mystery stopType.
import { classifyStopRole } from './stop-role.js';

export interface DeliveryGateStop {
  readonly sequence: number;
  readonly stopType: string;
  readonly warehouseName: string | null;
  readonly hasManifest: boolean;
}

export type DeliveryGateBlockedReason = 'pickups_incomplete';

export interface DeliveryGateResult {
  readonly allowed: boolean;
  readonly blockedReason: DeliveryGateBlockedReason | null;
  // Warehouse names of the pickups still missing a committed photo, in stop
  // sequence order. Empty when allowed. A pickup with no warehouseName is named
  // by a stable positional fallback so the guidance never shows a blank.
  readonly remainingPickupNames: readonly string[];
  // Vietnamese driver-facing guidance shown on a blocked capture tap (Alert).
  // Educational, not error-toned. Empty string when allowed.
  readonly message: string;
  // Short Vietnamese caption for the always-visible LOCKED-button state on the
  // card (prevention: the driver is guided before tapping). Empty when allowed.
  readonly guidanceHint: string;
}

const ALLOW: DeliveryGateResult = {
  allowed: true,
  blockedReason: null,
  remainingPickupNames: [],
  message: '',
  guidanceHint: '',
};

// Stable fallback label for a pickup with no warehouse name. Vietnamese
// production string; positional so two unnamed pickups stay distinguishable.
function pickupLabel(stop: DeliveryGateStop, index: number): string {
  return stop.warehouseName ?? ('Kho nhận hàng ' + String(index + 1));
}

// Evaluate whether capturing the stop at targetSequence is permitted right now.
// - Capturing a PICKUP is always allowed (order-independent; re-capture allowed).
// - Capturing the DELIVERY is allowed iff every pickup has hasManifest === true.
// - An unknown targetSequence, or a target that is not a delivery, is allowed
//   (never a false block).
export function evaluateDeliveryGate(
  stops: readonly DeliveryGateStop[],
  targetSequence: number,
): DeliveryGateResult {
  const target = stops.find((s) => s.sequence === targetSequence);
  if (target === undefined) return ALLOW;
  if (classifyStopRole(target.stopType) !== 'delivery') return ALLOW;

  const remaining = stops
    .filter((s) => classifyStopRole(s.stopType) === 'pickup' && !s.hasManifest)
    .sort((a, b) => a.sequence - b.sequence);
  if (remaining.length === 0) return ALLOW;

  const remainingPickupNames = remaining.map((s, i) => pickupLabel(s, i));
  // Educational copy: state the correct procedure first (photograph every
  // pickup, then the delivery), then name exactly which pickups still need a
  // photo so the driver knows where to go. Proper Vietnamese with diacritics.
  const message =
    'Cần chụp ảnh phiếu cân ở tất cả kho nhận hàng trước, rồi mới chụp kho giao hàng. ' +
    'Còn thiếu ảnh ở: ' + remainingPickupNames.join(', ') + '.';
  // Short always-visible caption for the locked delivery button.
  const guidanceHint = 'Chụp ảnh kho nhận hàng trước đã nhé';
  return { allowed: false, blockedReason: 'pickups_incomplete', remainingPickupNames, message, guidanceHint };
}
