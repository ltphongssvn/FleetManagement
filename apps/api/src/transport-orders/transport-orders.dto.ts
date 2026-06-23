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
// T3 (auto-numbering, 2026): the dispatcher does NOT submit Số Lệnh. The
// server allocates external_ref via OrderNumberingService and returns it on
// the create response. The DTO still accepts an optional externalRef field
// for backward compatibility with older clients, but the service ignores it.
import { z } from 'zod';
export const CreateTransportOrderSchema = z.object({
  externalRef: z.string().min(1).max(64).optional(),
  customerId: z.guid().optional(),
  cargoTypeId: z.guid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  stops: z.array(z.object({
    sequence: z.number().int().positive(),
    stopType: z.string().min(1).max(32),
    yardId: z.guid().optional(),
    plannedAt: z.iso.datetime().optional(),
  })).min(1).max(20),
  roadRun: z.object({
    plannedStartAt: z.iso.datetime().optional(),
    assignedOperatorId: z.guid(),
    assignedAssetId: z.guid(),
  }),
}).strict();
export type CreateTransportOrderInput = z.infer<typeof CreateTransportOrderSchema>;
export interface CreateTransportOrderResponse {
  readonly transportOrderId: string;
  readonly roadRunId: string;
  readonly externalRef: string;
}
export interface ListAssignedRow {
  readonly transportOrderId: string;
  readonly externalRef: string | null;
  readonly roadRunId: string;
  readonly state: string;
  readonly plannedStartAt: string | null;
  readonly createdAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly orderRef: string | null;
  readonly plate: string | null;
  readonly customerName: string | null;
  readonly cargoName: string | null;
  readonly driverName: string | null;
  readonly pickupName: string | null;
  readonly deliveryName: string | null;
  readonly stops: readonly {
    readonly sequence: number;
    readonly stopType: string;
    readonly plannedAt: string | null;
    readonly warehouseName: string | null;
    readonly arrivedAt: string | null;
    readonly departedAt: string | null;
  }[];
}
export interface ListAssignedResponse {
  readonly rows: readonly ListAssignedRow[];
}
export interface TripHistoryMonth {
  readonly monthKey: string;
  readonly label: string;
  readonly count: number;
  readonly trips: readonly ListAssignedRow[];
}
export interface TripHistoryResponse {
  readonly months: readonly TripHistoryMonth[];
}
