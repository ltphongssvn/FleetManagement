// packages/sync-protocol/src/list-assigned-contract.ts
// Single source of truth for the assigned-orders / dispatcher-review row
// contract (GET /transport-orders/assigned rows and the /:id review row).
//
// This shape was previously hand-written in TWO places -- apps/api
// transport-orders.dto.ts (interface ListAssignedRow) and apps/ops-web
// dispatch/types.ts (interface ListAssignedRow + ListAssignedRowStop) -- and the
// ops-web review page validated NOTHING, casting the BFF response with
// 'as ListAssignedRow'. Defining the schema here once lets: the API DTO import +
// re-export the inferred types (back-compat for its service/controller call
// sites), the ops-web feature types re-export the inferred type, and the review
// page PARSE the BFF response at the trust boundary instead of casting.
//
// Tolerance model mirrors the sibling DispatchBoardRowSchema: tolerant/strip (NOT
// .strict()) because this validates a server/BFF-produced JSON response whose ISO
// timestamps are carried as plain strings (not re-validated as .datetime()), and
// whose enrichment fields (driver/customer/cargo/warehouse names, plate, lifecycle
// timestamps) are nullable when a join is absent or the row is pre-projection.
// 'state' is z.string() (NOT the road-run enum) to exactly match the API DTO,
// which types this field as a plain string at this boundary.
import { z } from 'zod';

export const ListAssignedRowStopSchema = z.object({
  sequence: z.number().int(),
  stopType: z.string(),
  plannedAt: z.union([z.string(), z.null()]),
  warehouseName: z.union([z.string(), z.null()]),
  arrivedAt: z.union([z.string(), z.null()]),
  departedAt: z.union([z.string(), z.null()]),
  // Per-stop committed-proof signal (2026 delivery-capture gate). True
  // when the API found a manifest in a photo-received state joined on
  // this stopId. Tolerant default false so pre-gate payloads still parse
  // and the client treats an un-signalled stop as not-yet-photographed.
  hasManifest: z.boolean().default(false),
});
export type ListAssignedRowStop = z.infer<typeof ListAssignedRowStopSchema>;

export const ListAssignedRowSchema = z.object({
  transportOrderId: z.string(),
  externalRef: z.union([z.string(), z.null()]),
  roadRunId: z.string(),
  state: z.string(),
  plannedStartAt: z.union([z.string(), z.null()]),
  createdAt: z.union([z.string(), z.null()]),
  startedAt: z.union([z.string(), z.null()]),
  completedAt: z.union([z.string(), z.null()]),
  orderRef: z.union([z.string(), z.null()]),
  plate: z.union([z.string(), z.null()]),
  customerName: z.union([z.string(), z.null()]),
  cargoName: z.union([z.string(), z.null()]),
  driverName: z.union([z.string(), z.null()]),
  pickupName: z.union([z.string(), z.null()]),
  deliveryName: z.union([z.string(), z.null()]),
  stops: z.array(ListAssignedRowStopSchema).readonly(),
  // Server-computed cancel affordance (HATEOAS-style: the response carries the
  // information needed to know whether the cancel transition is available, so
  // the client NEVER re-derives the rule). canCancel=false with a non-null
  // cancelBlockedReason code (e.g. photos_received) means the order can no
  // longer be cancelled. Robustness principle: parser is liberal (defaults so
  // rows from endpoints that do not compute these still parse), producers are
  // conservative (the dispatcher-review path sends the real computed values).
  canCancel: z.boolean().default(true),
  cancelBlockedReason: z.union([z.string(), z.null()]).default(null),
});
export type ListAssignedRow = z.infer<typeof ListAssignedRowSchema>;

export const ListAssignedResponseSchema = z.object({
  rows: z.array(ListAssignedRowSchema).readonly(),
});
export type ListAssignedResponse = z.infer<typeof ListAssignedResponseSchema>;

export const TripHistoryMonthSchema = z.object({
  monthKey: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
  trips: z.array(ListAssignedRowSchema).readonly(),
});
export type TripHistoryMonth = z.infer<typeof TripHistoryMonthSchema>;

export const TripHistoryResponseSchema = z.object({
  months: z.array(TripHistoryMonthSchema).readonly(),
});
export type TripHistoryResponse = z.infer<typeof TripHistoryResponseSchema>;
