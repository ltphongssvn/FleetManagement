// apps/api/test/transport-orders.cancel.errors.test.ts
// L7 RED for T5: TransportOrderCannotBeCancelledError is the typed domain
// error thrown by TransportOrdersCancelService when the FSM rejects the
// requested transition (current state -> 'cancelled'). Follows the same
// shape as DriverVehicleAssignmentRequiredError and TransportOrderNotFoundError
// in apps/api/src/transport-orders/transport-orders.errors.ts so the cancel
// controller can translate it into a 409 Conflict at the HTTP boundary.
import { describe, it, expect } from 'vitest';
import {
  TransportOrderCannotBeCancelledError,
  TransportOrderError,
} from '../src/transport-orders/transport-orders.errors.js';
describe('@fleet/api - TransportOrderCannotBeCancelledError', () => {
  it('extends TransportOrderError so the error-class hierarchy stays a single tree', () => {
    const err = new TransportOrderCannotBeCancelledError('in_transit');
    expect(err).toBeInstanceOf(TransportOrderError);
    expect(err).toBeInstanceOf(Error);
  });
  it('sets a stable name so callers can switch on it without instanceof checks across boundaries', () => {
    const err = new TransportOrderCannotBeCancelledError('completed');
    expect(err.name).toBe('TransportOrderCannotBeCancelledError');
  });
  it('records the offending current state in the message for log/audit triage', () => {
    const err = new TransportOrderCannotBeCancelledError('completed');
    expect(err.message).toContain('completed');
  });
  it('exposes the currentState as a readable property for typed callers', () => {
    const err = new TransportOrderCannotBeCancelledError('in_transit');
    expect(err.currentState).toBe('in_transit');
  });
});
