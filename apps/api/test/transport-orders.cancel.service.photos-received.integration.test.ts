// apps/api/test/transport-orders.cancel.service.photos-received.integration.test.ts
// URGENT production invariant (RED -> GREEN): a dispatcher must NOT be able to
// cancel a transport order once a weigh-slip photo (phieu can / manifest) has
// been RECEIVED for it -- a received photo proves the run physically started
// and goods were handled, so the order is no longer safely cancellable.
//
// A manifest is treated as RECEIVED once its state is verifying/captured/
// committed (the upload was accepted into the pipeline). pending = row created
// but no photo yet; rejected = photo refused -- neither counts as received.
//
// Real PGlite schema round-trip so the manifest FK + state enum are exercised.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { TransportOrdersCancelService } from '../src/transport-orders/transport-orders.cancel.service.js';
import { TransportOrderCannotBeCancelledWithReceivedPhotosError } from '../src/transport-orders/transport-orders.errors.js';
import { transportOrder } from '../src/database/schema/transport.js';
import { manifest } from '../src/database/schema/manifest.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;

async function seedActivePair(
  tx: TestTx,
  op: ReturnType<typeof createOperatorContext>,
): Promise<{ operatorId: string; vehicleId: string }> {
  const tn = {
    companyId: op.companyId,
    businessUnitId: op.businessUnitId,
    depotId: op.depotId,
    legalEntityId: op.legalEntityId,
  };
  const [d] = await tx
    .insert(driver)
    .values({ ...tn, fullName: 'PhotoGuardDriver', operatorId: op.operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx
    .insert(vehicle)
    .values({ ...tn, plate: 'PGX-' + randomUUID().slice(0, 4) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  await tx
    .insert(driverVehicleAssignment)
    .values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId: op.operatorId, vehicleId: v.vehicleId };
}

async function insertReceivedManifest(
  tx: TestTx,
  op: ReturnType<typeof createOperatorContext>,
  transportOrderId: string,
  state: 'verifying' | 'captured' | 'committed',
): Promise<void> {
  const tn = {
    companyId: op.companyId,
    businessUnitId: op.businessUnitId,
    depotId: op.depotId,
    legalEntityId: op.legalEntityId,
  };
  await tx
    .insert(manifest)
    .values({ ...tn, transportOrderId, manifestCorrelationId: randomUUID(), state });
}

describe('@fleet/api - TransportOrdersCancelService photo-received guard (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });

  it('throws when a committed manifest (phieu can) exists for the order', async () => {
    let thrown: unknown;
    let persistedState: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const createSvc = new TransportOrdersService(tx as never);
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await createSvc.create(
        {
          externalRef: 'TO-PHOTO-1',
          stops: [
            { sequence: 1, stopType: 'pickup' },
            { sequence: 2, stopType: 'dropoff' },
          ],
          roadRun: {
            plannedStartAt: '2026-05-10T07:00:00.000Z',
            assignedOperatorId: operatorId,
            assignedAssetId: vehicleId,
          },
        },
        op,
      );
      await insertReceivedManifest(tx, op, created.transportOrderId, 'committed');
      try {
        await cancelSvc.cancel(created.transportOrderId, { reason: 'customer_request' }, op);
      } catch (e) {
        thrown = e;
      }
      const [row] = await tx
        .select()
        .from(transportOrder)
        .where(eq(transportOrder.transportOrderId, created.transportOrderId))
        .limit(1);
      persistedState = row?.state;
    });
    expect(thrown).toBeInstanceOf(TransportOrderCannotBeCancelledWithReceivedPhotosError);
    expect(persistedState).not.toBe('cancelled');
  });

  it('throws when a verifying manifest exists (photo uploaded, extraction pending)', async () => {
    let thrown: unknown;
    await withTxIsolation(testDb, async (tx) => {
      const createSvc = new TransportOrdersService(tx as never);
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await createSvc.create(
        {
          externalRef: 'TO-PHOTO-2',
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: {
            plannedStartAt: '2026-05-11T07:00:00.000Z',
            assignedOperatorId: operatorId,
            assignedAssetId: vehicleId,
          },
        },
        op,
      );
      await insertReceivedManifest(tx, op, created.transportOrderId, 'verifying');
      try {
        await cancelSvc.cancel(created.transportOrderId, { reason: 'customer_request' }, op);
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(TransportOrderCannotBeCancelledWithReceivedPhotosError);
  });

  it('still allows cancel when only a pending manifest row exists (no photo yet)', async () => {
    let cancelledState: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const createSvc = new TransportOrdersService(tx as never);
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await createSvc.create(
        {
          externalRef: 'TO-PHOTO-3',
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: {
            plannedStartAt: '2026-05-12T07:00:00.000Z',
            assignedOperatorId: operatorId,
            assignedAssetId: vehicleId,
          },
        },
        op,
      );
      const tn = {
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
      };
      await tx.insert(manifest).values({
        ...tn,
        transportOrderId: created.transportOrderId,
        manifestCorrelationId: randomUUID(),
        state: 'pending',
      });
      const res = await cancelSvc.cancel(
        created.transportOrderId,
        { reason: 'customer_request' },
        op,
      );
      cancelledState = res.state;
    });
    expect(cancelledState).toBe('cancelled');
  });
});
