// apps/ops-web/src/features/dispatch/types.ts
// Dispatch board view types. The board row + stop shapes are the SINGLE SOURCE
// OF TRUTH canonical Zod schemas in @fleet/sync-protocol (DispatchBoardRowSchema
// / DispatchBoardStopSchema); this module re-exports their inferred types under
// the ops-web-domain names used across the dispatch feature (one road_run == one
// board row). No board shape is re-declared here — there is exactly one
// definition, in the contract package, that the API and ops-web both derive from.
export type {
  StopProof,
  DispatchBoardStop,
  DispatchBoardRow as DispatchBoardRoadRun,
} from '@fleet/sync-protocol';

// Mirrors API ListAssignedRow (apps/api/src/transport-orders/transport-orders.dto.ts).
// Used by the dispatcher review view to render one order with its road-run,
// stops, and enrichment fields. (Unrelated to the board row shape above.)
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
