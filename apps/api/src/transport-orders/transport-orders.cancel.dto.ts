// apps/api/src/transport-orders/transport-orders.cancel.dto.ts
// T5 (2026): typed input/output for the cancel-order seam.
//
// SCHEMA-FIRST SSOT (cancel-refactor 2026): the reason vocabulary is NO LONGER
// defined here. It lives once in @fleet/domain (CancelReasonSchema) and is
// imported below; this DTO previously declared its own z.enum copy, which had
// drifted from the ops-web copy. CancelReasonSchema + CancelReason are
// re-exported so existing import paths through this DTO keep working.
//
// This module still owns the HTTP-boundary INPUT envelope (CancelOrderInputSchema)
// because note length/strictness is an API-request concern, and the OUTPUT shape
// (CancelOrderResult) which is an internal API return type (not a trust-boundary
// input, not duplicated) and so is a plain TypeScript interface by design.
//
// The 'other' reason bucket exists so dispatchers are never blocked when the
// precise reason is not enumerated; the optional 'note' is then strongly
// encouraged at the UI layer. note is min(1) so an all-whitespace/empty string
// cannot masquerade as a provided note; the action layer trims before sending.
import { z } from 'zod';
import { CancelReasonSchema, type CancelReason } from '@fleet/domain';
export { CancelReasonSchema, type CancelReason };
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
