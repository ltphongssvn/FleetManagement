// packages/test-fixtures/src/list-assigned-fixtures.ts
// Row fixtures for the assigned-orders / trip-history contract, VALID BY
// CONSTRUCTION.
//
// ROOT CAUSE THIS ELIMINATES. Every consumer hand-wrote its own row literal,
// and those literals drifted from ListAssignedRowSchema: the driver-app trip
// history fixtures were missing externalRef, createdAt, cargoName, driverName,
// canCancel and cancelBlockedReason -- the exact six fields the hand-rolled
// parser silently dropped. A fixture and a parser drifting together hide each
// other, so the suite stayed green while neither matched the wire.
//
// Correcting the literals fixes the instance; building them through the schema
// makes the drift unreachable, because a fixture that no longer satisfies the
// contract fails HERE at construction rather than in whichever consumer
// happens to notice first. Same reasoning as testSha() in provenance-fixtures.
import {
  ListAssignedRowSchema,
  ListAssignedRowStopSchema,
  type ListAssignedRow,
  type ListAssignedRowStop,
} from '@fleet/sync-protocol';

/** A schema-valid assigned/completed row. Overrides are applied BEFORE parsing,
 *  so an override that violates the contract throws instead of producing a
 *  fixture no production code could ever receive. */
export function createListAssignedRow(overrides: Partial<ListAssignedRow> = {}): ListAssignedRow {
  return ListAssignedRowSchema.parse({
    transportOrderId: 'to-fixture-1',
    externalRef: 'XTT.08-001',
    roadRunId: 'rr-fixture-1',
    state: 'completed',
    plannedStartAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    startedAt: '2026-08-01T01:00:00.000Z',
    completedAt: '2026-08-01T05:00:00.000Z',
    orderRef: 'XTT.08-001',
    plate: '51C-123.45',
    customerName: 'Khach hang A',
    cargoName: 'Gao',
    driverName: 'Tai xe B',
    pickupName: 'Kho 1',
    deliveryName: 'Kho 2',
    stops: [],
    canCancel: true,
    cancelBlockedReason: null,
    ...overrides,
  });
}

/** One stop in the ordered stops[] list, schema-valid by construction.
 *
 *  Parses the STOP schema directly rather than building a row and indexing
 *  stops[0]: that route needed a cast to convince TypeScript the element
 *  existed, and a cast in a fixture factory defeats the point -- the factory
 *  exists so no consumer has to assert a shape is valid. */
export function createListAssignedStop(
  overrides: Partial<ListAssignedRowStop> = {},
): ListAssignedRowStop {
  return ListAssignedRowStopSchema.parse({
    sequence: 1,
    stopType: 'pickup',
    plannedAt: null,
    warehouseName: 'Kho 1',
    arrivedAt: null,
    departedAt: null,
    ...overrides,
  });
}
