// packages/domain/src/transport/cancel-reason.ts
// Single source of truth for the transport-order cancellation reason
// vocabulary. Mirrors the canonical manifest-rejection-reason pattern:
// an 'as const' array is the ONE definition; the literal-union type and the
// Zod schema are both DERIVED from it (schema-first SSOT).
//
// Consumed by (was previously redeclared/hardcoded in each):
//   - apps/api/src/transport-orders/transport-orders.cancel.dto.ts (z.enum)
//   - apps/ops-web/src/features/dispatch/cancel-order.action.ts    (z.enum)
//   - apps/ops-web/src/features/dispatch/CancelOrderForm.tsx       (REASON_OPTIONS values)
//   - packages/sync-protocol order_cancelled timeline event        (reason field)
//
// Reason categories follow the 2026 dispatch best-practice set (customer
// cancellation, driver/vehicle unavailability, weather, duplicate order,
// other). The 'other' bucket guarantees a dispatcher is never blocked when the
// precise reason is not enumerated; UI strongly encourages the free-text note
// in that case. Display labels are Vietnamese and live in the UI layer (these
// codes are the stable, ASCII contract values, never shown raw to dispatchers).
import { z } from 'zod';

export const CANCEL_REASONS = Object.freeze([
  'customer_request',
  'driver_unavailable',
  'vehicle_breakdown',
  'weather',
  'duplicate',
  'other',
] as const);
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const CancelReasonSchema = z.enum(CANCEL_REASONS);
