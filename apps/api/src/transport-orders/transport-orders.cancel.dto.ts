// apps/api/src/transport-orders/transport-orders.cancel.dto.ts
// T5 (2026): typed input/output for the cancel-order seam.
//
// Reason enum follows the 2026 dispatch best-practice categories
// (customer cancellation, driver/vehicle unavailability, weather, duplicate
// order, other). Sources: Chauffeur Driven cancellation policy benchmark,
// eLogii dispatch operations guide, Google OrderState CANCELLED mapping.
//
// The 'other' bucket exists so dispatchers are never blocked when the right
// reason is not in the enum, but the optional 'note' is then strongly
// encouraged at the UI layer.
import { z } from 'zod';
export const CancelReasonSchema = z.enum([
  'customer_request',
  'driver_unavailable',
  'vehicle_breakdown',
  'weather',
  'duplicate',
  'other',
]);
export type CancelReason = z.infer<typeof CancelReasonSchema>;
export const CancelOrderInputSchema = z.object({
  reason: CancelReasonSchema,
  note: z.string().min(1).max(500).optional(),
}).strict();
export type CancelOrderInput = z.infer<typeof CancelOrderInputSchema>;
export interface CancelOrderResult {
  readonly transportOrderId: string;
  readonly state: 'cancelled';
  readonly cancelledAt: string;
  readonly cancelledBy: string;
  readonly cancellationReason: string;
  readonly cancellationNote: string | null;
  readonly idempotent: boolean;
}
