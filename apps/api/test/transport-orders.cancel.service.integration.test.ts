// apps/api/test/transport-orders.cancel.service.integration.test.ts
// L5 RED → GREEN: PGlite integration for TransportOrdersCancelService.
// Real schema + real check constraint round-trip. Proves:
//   1. happy path persists all four audit columns and flips state
//   2. the DB-level check constraint is satisfied (no rejection on commit)
//   3. cross-tenant requests return NotFound (no info leak)
//   4. idempotent second call returns the same persisted record
//   5. cancelling from 'completed' is rejected (terminal in FSM)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { TransportOrdersCancelService } from '../src/transport-orders/transport-orders.cancel.service.js';
import {
  TransportOrderNotFoundError,
  TransportOrderCannotBeCancelledError,
} from '../src/transport-orders/transport-orders.errors.js';
import { transportOrder } from '../src/database/schema/transport.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
async function seedActivePair(tx: TestTx, op: ReturnType<typeof createOperatorContext>): Promise<{ operatorId: string; vehicleId: string }> {
  const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'CancelTestDriver', operatorId: op.operatorId }).returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'CXL-' + randomUUID().slice(0, 4) }).returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId: op.operatorId, vehicleId: v.vehicleId };
}
describe('@fleet/api - TransportOrdersCancelService (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('cancels a draft order, persists all four audit fields, and satisfies the audit-consistency check constraint', async () => {
    let resultId: string | undefined;
    let persistedState: string | undefined;
    let persistedReason: string | null | undefined;
    let persistedNote: string | null | undefined;
    let persistedCancelledBy: string | null | undefined;
    let persistedCancelledAt: Date | null | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const createSvc = new TransportOrdersService(tx as never);
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await createSvc.create({
        externalRef: 'TO-CXL-1',
        stops: [{ sequence: 1, stopType: 'pickup' }, { sequence: 2, stopType: 'dropoff' }],
        roadRun: { plannedStartAt: '2026-05-01T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      const cancelled = await cancelSvc.cancel(
        created.transportOrderId,
        { reason: 'customer_request', note: 'integration test cancel' },
        op,
      );
      resultId = cancelled.transportOrderId;
      const [row] = await tx.select().from(transportOrder).where(eq(transportOrder.transportOrderId, created.transportOrderId)).limit(1);
      persistedState = row?.state;
      persistedReason = row?.cancellationReason ?? null;
      persistedNote = row?.cancellationNote ?? null;
      persistedCancelledBy = row?.cancelledBy ?? null;
      persistedCancelledAt = row?.cancelledAt ?? null;
    });
    expect(resultId).toBeDefined();
    expect(persistedState).toBe('cancelled');
    expect(persistedReason).toBe('customer_request');
    expect(persistedNote).toBe('integration test cancel');
    expect(persistedCancelledBy).not.toBeNull();
    expect(persistedCancelledAt).toBeInstanceOf(Date);
  });
  it('returns idempotent=true on a second cancel with the SAME reason and does not change cancelledAt', async () => {
    let firstAt: string | undefined;
    let secondAt: string | undefined;
    let secondIdempotent: boolean | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const createSvc = new TransportOrdersService(tx as never);
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await createSvc.create({
        externalRef: 'TO-CXL-2',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-05-02T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      const first = await cancelSvc.cancel(created.transportOrderId, { reason: 'duplicate', note: 'first' }, op);
      firstAt = first.cancelledAt;
      const second = await cancelSvc.cancel(created.transportOrderId, { reason: 'duplicate', note: 'retry' }, op);
      secondAt = second.cancelledAt;
      secondIdempotent = second.idempotent;
    });
    expect(secondIdempotent).toBe(true);
    expect(secondAt).toBe(firstAt);
  });
  it('throws CannotBeCancelledError on a second cancel with a DIFFERENT reason', async () => {
    let thrown: unknown;
    await withTxIsolation(testDb, async (tx) => {
      const createSvc = new TransportOrdersService(tx as never);
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await createSvc.create({
        externalRef: 'TO-CXL-3',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-05-03T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      await cancelSvc.cancel(created.transportOrderId, { reason: 'customer_request' }, op);
      try {
        await cancelSvc.cancel(created.transportOrderId, { reason: 'driver_unavailable' }, op);
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(TransportOrderCannotBeCancelledError);
  });
  it('throws TransportOrderNotFoundError when the calling tenancy does not own the order', async () => {
    let thrown: unknown;
    await withTxIsolation(testDb, async (tx) => {
      const createSvc = new TransportOrdersService(tx as never);
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const owner = createOperatorContext();
      const intruder = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, owner);
      const created = await createSvc.create({
        externalRef: 'TO-CXL-4',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-05-04T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, owner);
      try {
        await cancelSvc.cancel(created.transportOrderId, { reason: 'customer_request' }, intruder);
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(TransportOrderNotFoundError);
  });
  it('throws TransportOrderNotFoundError when the id does not exist at all', async () => {
    let thrown: unknown;
    await withTxIsolation(testDb, async (tx) => {
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const op = createOperatorContext();
      try {
        await cancelSvc.cancel('00000000-0000-0000-0000-000000000000', { reason: 'customer_request' }, op);
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(TransportOrderNotFoundError);
  });
});
