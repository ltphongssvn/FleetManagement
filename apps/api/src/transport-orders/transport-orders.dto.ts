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
//
// SCHEMA-FIRST SSOT (P0-#2, 2026): the assigned-orders / review row contract
// (ListAssignedRow + stop, ListAssignedResponse, TripHistory*) is NO LONGER
// hand-written here. It lives once as Zod schemas in @fleet/sync-protocol and is
// re-exported below so this DTO's service/controller call sites keep importing
// the same type names. ops-web previously RE-DECLARED the identical row shape and
// CAST its BFF response 'as ListAssignedRow'; both now derive from the one schema
// (ops-web parses at its boundary). The create-side schema below stays local: it
// is request-input validation specific to this endpoint, not a shared read shape.
import { z } from 'zod';
export {
  type ListAssignedRowStop,
  type ListAssignedRow,
  type ListAssignedResponse,
  type TripHistoryMonth,
  type TripHistoryResponse,
} from '@fleet/sync-protocol';
export const CreateTransportOrderSchema = z
  .object({
    externalRef: z.string().min(1).max(64).optional(),
    customerId: z.guid().optional(),
    cargoTypeId: z.guid().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    stops: z
      .array(
        z.object({
          sequence: z.number().int().positive(),
          stopType: z.string().min(1).max(32),
          yardId: z.guid().optional(),
          plannedAt: z.iso.datetime().optional(),
        }),
      )
      .min(1)
      .max(20),
    roadRun: z.object({
      plannedStartAt: z.iso.datetime().optional(),
      assignedOperatorId: z.guid(),
      assignedAssetId: z.guid(),
    }),
  })
  .strict();
export type CreateTransportOrderInput = z.infer<typeof CreateTransportOrderSchema>;
export interface CreateTransportOrderResponse {
  readonly transportOrderId: string;
  readonly roadRunId: string;
  readonly externalRef: string;
}
