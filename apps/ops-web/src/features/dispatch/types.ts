// apps/ops-web/src/features/dispatch/types.ts
// Mirrors API dispatch_board_projection per Frozen Stack PDF 'Ops web (single page)'.
import type { RoadRunState } from '@fleet/domain';
export interface DispatchBoardRoadRun {
  readonly roadRunId: string;
  readonly state: RoadRunState;
  readonly assignedOperatorId: string | null;
  readonly assignedAssetId: string | null;
  readonly plannedStartAt: string | null;
  readonly stopCount: number;
  readonly transportOrderRefs: readonly string[];
}
// Mirrors API ListAssignedRow (apps/api/src/transport-orders/transport-orders.dto.ts).
// Used by the dispatcher review view to render one order with its road-run,
// stops, and enrichment fields.
export interface ListAssignedRowStop {
  readonly sequence: number;
  readonly stopType: string;
  readonly plannedAt: string | null;
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
  readonly cargoName: string | null;
  readonly driverName: string | null;
  readonly pickupName: string | null;
  readonly deliveryName: string | null;
  readonly stops: readonly ListAssignedRowStop[];
}
