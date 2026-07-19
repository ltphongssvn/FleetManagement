// packages/domain/src/transport/cancel-order-input.ts
// Single source of truth for the transport-order cancellation INPUT envelope,
// shared by the API HTTP boundary (transport-orders.cancel.dto) and the
// ops-web server action (cancel-order.action). Both previously hand-declared
// their own z.object with reason + note, which had already drifted; this
// collapses them to one derived contract (schema-first, fix-trigger 2).
//
// Business invariant (2026): a cancellation must record WHY. An enumerated
// reason is itself the recorded why. The open-ended other bucket only counts
// as a recorded reason when it carries a non-empty free-text note -- so
// reason===other REQUIRES note, while every enumerated reason keeps note
// optional. Enforced here via .refine (the house cross-field idiom, cf.
// auth-context.schema), so no request path -- UI, action, or direct API --
// can record a cancellation with no reason.
//
// note is min(1).max(500): min(1) so an all-whitespace/empty string cannot
// masquerade as a note (callers trim before parsing); max(500) is the audit
// field ceiling. .strict() rejects unknown keys at the trust boundary.
import { z } from 'zod';
import { CancelReasonSchema } from './cancel-reason.js';
export const CancelOrderInputSchema = z
  .object({
    reason: CancelReasonSchema,
    note: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => v.reason !== 'other' || (v.note !== undefined && v.note.trim().length > 0), {
    path: ['note'],
    message: 'A note is required when the reason is other',
  });
export type CancelOrderInput = z.infer<typeof CancelOrderInputSchema>;
