// apps/api/src/transport-orders/transport-orders.dto.ts
//
// 2026 business rule: a transport_order is never created without a road_run
// that already binds a driver (assignedOperatorId) to a truck (assignedAssetId).
// The driver-vehicle pair must be backed by an active driver_vehicle_assignment
// row in the calling tenancy — that pair-existence check is enforced at the
// service layer (see TransportOrdersService.create); this DTO is the outer
// schema-level guard so malformed inputs are rejected before they reach the
// service.
//
// Migration note: prior versions allowed roadRun, assignedOperatorId, and
// assignedAssetId to be omitted at create time. That code path has been
// removed because the dispatch board UI does not surface unassigned orders
// and ERP-inbound flows do not create transport_order rows directly.
import { z } from 'zod';
export const CreateTransportOrderSchema = z.object({
  externalRef: z.string().min(1).max(64).optional(),
  customerId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  stops: z.array(z.object({
    sequence: z.number().int().positive(),
    stopType: z.string().min(1).max(32),
    yardId: z.string().uuid().optional(),
    plannedAt: z.string().datetime().optional(),
  })).min(1).max(20),
  roadRun: z.object({
    plannedStartAt: z.string().datetime().optional(),
    assignedOperatorId: z.string().uuid(),
    assignedAssetId: z.string().uuid(),
  }),
}).strict();
export type CreateTransportOrderInput = z.infer<typeof CreateTransportOrderSchema>;
export interface CreateTransportOrderResponse {
  readonly transportOrderId: string;
  readonly roadRunId: string;
}
export interface ListAssignedRow {
  readonly transportOrderId: string;
  readonly externalRef: string | null;
  readonly roadRunId: string;
  readonly state: string;
  readonly plannedStartAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly orderRef: string | null;
  readonly plate: string | null;
  readonly customerName: string | null;
  readonly pickupName: string | null;
  readonly deliveryName: string | null;
  readonly stops: readonly {
    readonly sequence: number;
    readonly stopType: string;
    readonly plannedAt: string | null;
  }[];
}
export interface ListAssignedResponse {
  readonly rows: readonly ListAssignedRow[];
}
// Trip-history endpoint: completed runs grouped by VN-timezone month. The
// grouping itself is delegated to @fleet/domain groupCompletedTripsByMonth so
// the API and the driver app agree on month boundaries.
export interface TripHistoryMonth {
  readonly monthKey: string;
  readonly label: string;
  readonly count: number;
  readonly trips: readonly ListAssignedRow[];
}
export interface TripHistoryResponse {
  readonly months: readonly TripHistoryMonth[];
}
