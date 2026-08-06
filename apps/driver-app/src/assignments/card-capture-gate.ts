// apps/driver-app/src/assignments/card-capture-gate.ts
// Thin driver-app adapter over the shared @fleet/domain delivery-capture rule.
// Maps the driver-app StopRow list to the domain evaluateDeliveryGate so the
// assignment card can block a delivery-capture tap until every pickup stop has
// a committed photo (hasManifest). The invariant itself is NOT re-implemented
// here -- it lives once in @fleet/domain and is also enforced server-side; this
// only bridges the StopRow shape to that rule and re-exports its result for the
// card onPress + Alert. 2026 domain-invariant best practice: one rule, many
// call sites.
import { evaluateDeliveryGate, type DeliveryGateResult } from '@fleet/domain';
import type { StopRow } from './assignments-client.js';

// Evaluate whether tapping the capture button for the stop at targetSequence is
// allowed right now. Pickups are always allowed (order-independent); the
// delivery is blocked until every pickup carries hasManifest === true. Returns
// the shared DeliveryGateResult (allowed / blockedReason / remainingPickupNames
// / Vietnamese message) so the card can Alert and skip navigation on block.
export function evaluateCardCaptureGate(
  stops: readonly StopRow[],
  targetSequence: number,
): DeliveryGateResult {
  return evaluateDeliveryGate(
    stops.map((s) => ({
      sequence: s.sequence,
      stopType: s.stopType,
      warehouseName: s.warehouseName,
      hasManifest: s.hasManifest,
    })),
    targetSequence,
  );
}
