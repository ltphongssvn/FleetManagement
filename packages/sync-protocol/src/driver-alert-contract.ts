// packages/sync-protocol/src/driver-alert-contract.ts
// Driver alert wire contract SSOT (T12 driver-order-alerts arc).
// One schema family, two wire surfaces, zero re-declaration (two-axis rule):
//   1) DriverAlertJobSchema  -- BullMQ 'alerts' queue body. Producer: the
//      transport-order creation tx writes this shape (minus envelope) into the
//      outbox; the relay strips {aggregateType, eventType, serverSeq} and
//      enqueues the BODY. Consumer: the api-hosted alerts worker strict-parses
//      it at the queue trust boundary (ZodError -> dead-letter, mirroring
//      workers/main-worker/src/queue-router.ts).
//   2) DriverAlertPushDataSchema -- the notification 'data' payload sent to the
//      device via Expo push. DERIVED from the job schema via .omit: the
//      operator id is the SERVER-side address, never shipped to the phone.
//      The driver-app notification handler safeParses this at its own trust
//      boundary before navigating.
// Body is self-contained (operator + run + human ref) so the consumer performs
// zero joins: an alert survives even if the order row is later mutated.
// externalRef is the dispatcher-facing order code (e.g. 'XTT.07-001'), the
// only human-readable value; Vietnamese title/body strings are PRESENTATION,
// composed in the api sender, never part of this contract.
import { z } from 'zod';

export const DRIVER_ALERT_KINDS = Object.freeze(['transport_order_created'] as const);
export type DriverAlertKind = (typeof DRIVER_ALERT_KINDS)[number];
export const DriverAlertKindSchema = z.enum(DRIVER_ALERT_KINDS);

/** Wire body of one 'alerts' queue job. Strict: envelope-key leaks must fail loudly. */
export const DriverAlertJobSchema = z.object({
  alertKind: DriverAlertKindSchema,
  assignedOperatorId: z.guid(),
  roadRunId: z.guid(),
  externalRef: z.string().min(1).max(64),
}).strict();
export type DriverAlertJob = z.infer<typeof DriverAlertJobSchema>;

/** Device-facing notification data payload: the job body minus the server-side address. */
export const DriverAlertPushDataSchema = DriverAlertJobSchema.omit({ assignedOperatorId: true }).strict();
export type DriverAlertPushData = z.infer<typeof DriverAlertPushDataSchema>;
