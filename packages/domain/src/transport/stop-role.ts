// packages/domain/src/transport/stop-role.ts
// Single source of truth for the stop-role vocabulary the driver/delivery
// workflow reasons about. Mirrors the canonical manifest-rejection-reason
// pattern: one 'as const' array is the ONE definition; the literal-union type
// and the Zod schema are both DERIVED from it (schema-first SSOT).
//
// Why this exists: stopType is persisted as a free varchar(32) and production
// data uses 'pickup' | 'delivery' | 'dropoff' in mixed case. The
// pickup-vs-delivery classification was hand-copied via ad-hoc toLowerCase
// compares in >=4 places (transport-orders.service.ts findByCompanyIdOrRef x2,
// buildDriverRows pickupNameOf/deliveryNameOf x2). classifyStopRole folds that
// real raw vocabulary into the two canonical roles ONCE, so every consumer --
// including the delivery-capture gate -- derives from here instead of
// re-deriving the rule. 2026 domain-invariant best practice: the rule lives in
// the model, defined a single time.
//
// STOP_ROLES is the NORMALIZED output vocabulary (pickup | delivery), distinct
// from the raw persisted stopType strings ('dropoff' etc.) that classifyStopRole
// accepts as input.
import { z } from 'zod';

export const STOP_ROLES = Object.freeze(['pickup', 'delivery'] as const);
export type StopRole = (typeof STOP_ROLES)[number];
export const StopRoleSchema = z.enum(STOP_ROLES);

// Normalize a raw persisted stopType into a canonical StopRole.
// - case-insensitive, trims surrounding whitespace
// - 'delivery' and 'dropoff' both normalize to 'delivery'
// - anything else (incl. unknown/empty) normalizes to 'pickup' as a FAIL-SAFE:
//   an unclassifiable stop is treated as a pickup, so it still counts toward the
//   set that must be photographed before delivery is unlocked (the gate can
//   never be bypassed by a mystery stopType).
export function classifyStopRole(rawStopType: string): StopRole {
  const t = rawStopType.trim().toLowerCase();
  if (t === 'delivery' || t === 'dropoff') return 'delivery';
  return 'pickup';
}
