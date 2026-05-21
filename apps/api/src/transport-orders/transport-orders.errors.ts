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
// Thrown by TransportOrdersService.findById when the requested order does not
// exist in the calling operator's tenancy. The review controller translates
// this domain error into a NestJS NotFoundException at the HTTP boundary so
// callers see a plain 404 without leaking internal class names.
export class TransportOrderNotFoundError extends TransportOrderError {
  constructor(message = 'Transport order not found') {
    super(message);
    this.name = 'TransportOrderNotFoundError';
  }
}
