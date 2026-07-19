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
// T5 (2026): thrown by TransportOrdersCancelService when the requested
// state -> 'cancelled' transition is not legal per transportOrderFsm
// (e.g. attempting to cancel an already-completed or already-cancelled
// order with a different reason). The cancel controller translates this
// domain error into a 409 Conflict at the HTTP boundary so callers see a
// stable status code without leaking internal class names. The currentState
// field is preserved as a typed property so log/audit pipelines can pivot on
// it without parsing the message string.
export class TransportOrderCannotBeCancelledError extends TransportOrderError {
  readonly currentState: string;
  constructor(currentState: string, message?: string) {
    super(message ?? 'Transport order cannot be cancelled from state: ' + currentState);
    this.name = 'TransportOrderCannotBeCancelledError';
    this.currentState = currentState;
  }
}
// URGENT production invariant (2026): thrown by TransportOrdersCancelService
// when a dispatcher attempts to cancel an order for which a weigh-slip photo
// (phieu can / manifest) has already been RECEIVED. A received photo proves the
// run physically started and goods were handled, so cancellation is no longer
// safe regardless of the coarse FSM state. Distinct from the FSM-state error so
// the controller can surface a precise localized message and audit pipelines can
// pivot on this specific cause. Mapped to 409 Conflict at the HTTP boundary.
export class TransportOrderCannotBeCancelledWithReceivedPhotosError extends TransportOrderError {
  readonly receivedManifestCount: number;
  constructor(receivedManifestCount: number, message?: string) {
    super(message ?? 'Transport order cannot be cancelled: weigh-slip photos have been received');
    this.name = 'TransportOrderCannotBeCancelledWithReceivedPhotosError';
    this.receivedManifestCount = receivedManifestCount;
  }
}
