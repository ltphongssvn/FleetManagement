// packages/sync-protocol/src/order-timeline-contract.ts
// Zod-first read-model contract (2026 contract-first): SINGLE SOURCE OF TRUTH for
// the admin order-timeline endpoint GET /admin/orders/:externalRef/timeline.
// Replaces ad-hoc psql forensics ("what happened to XTT.06-006?") with a typed,
// time-ordered event stream derived from authoritative tables (transport_order,
// road_run, stop, manifest) — the GitHub/Zendesk audit-log shape: one entity,
// typed events, UTC timestamps, admin-scoped. The API validates its OUTGOING
// response against this; consumers parse the same schema so they cannot diverge.
import { z } from 'zod';

const at = z.iso.datetime();
const seq = z.number().int().positive();

/** Discriminated union of every business event the timeline can carry. */
export const OrderTimelineEventSchema = z.discriminatedUnion('eventType', [
  z.object({ eventType: z.literal('order_created'), at }).strict(),
  z.object({
    eventType: z.literal('order_cancelled'), at,
    reason: z.union([z.string(), z.null()]),
    note: z.union([z.string(), z.null()]),
  }).strict(),
  z.object({ eventType: z.literal('run_created'), at, roadRunId: z.guid() }).strict(),
  z.object({ eventType: z.literal('run_started'), at, roadRunId: z.guid() }).strict(),
  z.object({ eventType: z.literal('run_completed'), at, roadRunId: z.guid() }).strict(),
  z.object({
    eventType: z.literal('stop_arrived'), at,
    stopSequence: seq, stopType: z.string().min(1),
  }).strict(),
  z.object({
    eventType: z.literal('stop_departed'), at,
    stopSequence: seq, stopType: z.string().min(1),
  }).strict(),
  z.object({
    eventType: z.literal('manifest_negotiated'), at,
    manifestId: z.guid(),
    // null => legacy client sent no stop ref at negotiate (back-compat truth,
    // surfaced honestly instead of hidden — the XTT.06-006 lesson).
    boundStopSequence: z.union([seq, z.null()]),
  }).strict(),
  z.object({
    eventType: z.literal('manifest_committed'), at,
    manifestId: z.guid(),
    boundStopSequence: z.union([seq, z.null()]),
  }).strict(),
  z.object({
    eventType: z.literal('manifest_rejected'), at,
    manifestId: z.guid(),
    boundStopSequence: z.union([seq, z.null()]),
    reasonText: z.union([z.string(), z.null()]),
  }).strict(),
]);
export type OrderTimelineEvent = z.infer<typeof OrderTimelineEventSchema>;

/** The endpoint response: the order identity + its events sorted by `at` asc. */
export const OrderTimelineSchema = z.object({
  externalRef: z.string().min(1),
  transportOrderId: z.guid(),
  events: z.array(OrderTimelineEventSchema),
}).strict();
export type OrderTimeline = z.infer<typeof OrderTimelineSchema>;
