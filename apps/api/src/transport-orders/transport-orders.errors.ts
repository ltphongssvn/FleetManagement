// apps/api/src/transport-orders/transport-orders.errors.ts
// Typed domain errors thrown by TransportOrdersService. Follows the repo
// convention of one *.errors.ts per module (cf. auth.errors.ts,
// device.errors.ts, manifest.errors.ts). Tests assert against these classes
// instead of regex message matching so unrelated runtime/DB errors cannot
// produce false-positive greens.
export class TransportOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportOrderError';
  }
}
// Thrown when a road_run is submitted but the (assignedOperatorId,
// assignedAssetId) pair does not match an active driver_vehicle_assignment
// row in the calling operator's company. Deepest defense layer behind
// client-side dropdown filtering and the server action's Zod gate.
export class DriverVehicleAssignmentRequiredError extends TransportOrderError {
  constructor(message = 'Driver and truck assignment is required') {
    super(message);
    this.name = 'DriverVehicleAssignmentRequiredError';
  }
}
