// apps/ops-web/src/features/dispatch/types.ts
// Mirrors API dispatch_board_projection per Frozen Stack PDF 'Ops web (single page)'.
import type { RoadRunState } from '@fleet/domain';
import type { StopProof } from '@fleet/sync-protocol';
export interface DispatchBoardStop {
  readonly sequence: number;
  readonly stopType: string;
  readonly warehouseName: string | null;
  readonly arrivedAt: string | null;
  readonly departedAt: string | null;
  // Per-stop proof photo (Phiếu Cân). Shape is the single-source-of-truth
  // StopProof from @fleet/sync-protocol. null when no committed manifest is
  // tied to this stop. EXPAND-only: existing fields unchanged.
  readonly proof: StopProof | null;
}
export interface DispatchBoardRoadRun {
  readonly roadRunId: string;
  readonly state: RoadRunState;
  readonly assignedOperatorId: string | null;
  readonly assignedAssetId: string | null;
  // Server-resolved labels (2026): the API board endpoint resolves the
  // assigned driver/vehicle to driver.full_name and vehicle.plate via a
  // company-scoped LEFT JOIN, so the board no longer depends on the
  // pair-filtered dispatch-form dropdown lists to render Tài xế/Xe. Null when
  // the reference row is missing (ops-web renders em-dash) or for the
  // optimistic (pre-projection) row.
  readonly driverName: string | null;
  readonly vehiclePlate: string | null;
  readonly plannedStartAt: string | null;
  readonly stopCount: number;
  readonly transportOrderRefs: readonly string[];
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly stops: readonly DispatchBoardStop[];
}
// Mirrors API ListAssignedRow (apps/api/src/transport-orders/transport-orders.dto.ts).
// Used by the dispatcher review view to render one order with its road-run,
// stops, and enrichment fields.
export interface ListAssignedRowStop {
  readonly sequence: number;
  readonly stopType: string;
  readonly plannedAt: string | null;
  readonly warehouseName: string | null;
  readonly arrivedAt: string | null;
  readonly departedAt: string | null;
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
  readonly stops: readonly ListAssignedRowStop[];
}
