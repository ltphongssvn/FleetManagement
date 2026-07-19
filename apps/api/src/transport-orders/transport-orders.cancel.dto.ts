// apps/api/src/transport-orders/transport-orders.cancel.dto.ts
// T5 (2026): typed input/output for the cancel-order seam.
//
// SCHEMA-FIRST SSOT (cancel-requires-reason 2026): the INPUT envelope is NO
// LONGER declared here. Both the reason vocabulary AND the full cancel input
// contract (reason + optional note + the reason===other-requires-note
// invariant) live once in @fleet/domain (CancelOrderInputSchema) and are
// imported below. This DTO previously hand-declared its own z.object, which
// duplicated the ops-web action copy and could not carry a shared invariant.
// CancelReasonSchema/CancelReason and CancelOrderInputSchema/CancelOrderInput
// are re-exported so existing import paths through this DTO keep working.
//
// The business invariant (a cancellation must record WHY): an enumerated
// reason is the recorded why; the open-ended other bucket additionally
// REQUIRES a non-empty note. Enforced in the shared schema so no request
// path -- API, action, or UI -- can record a why-less cancellation.
//
// The OUTPUT shape (CancelOrderResult) stays a plain TypeScript interface: it
// is an internal API return type, not a trust-boundary input and not
// duplicated, so Zod there would be redundant (two-axis rule).
import {
  CancelReasonSchema,
  type CancelReason,
  CancelOrderInputSchema,
  type CancelOrderInput,
} from '@fleet/domain';
export { CancelReasonSchema, type CancelReason, CancelOrderInputSchema, type CancelOrderInput };
export interface CancelOrderResult {
  readonly transportOrderId: string;
  readonly state: 'cancelled';
  readonly cancelledAt: string;
  readonly cancelledBy: string;
  readonly cancellationReason: string;
  readonly cancellationNote: string | null;
  readonly idempotent: boolean;
}
