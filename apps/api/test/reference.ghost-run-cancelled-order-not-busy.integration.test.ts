// apps/api/test/reference.ghost-run-cancelled-order-not-busy.integration.test.ts
// RED-first (T9 ghost-run arc, 2026-07-10): a road_run in a non-terminal
// state whose EVERY linked transport_order is terminal (cancelled or
// completed) is a GHOST -- it cannot represent live work and must NOT mark
// its pair busy. Observed live in prod: road_run dd964ecd (state=started,
// created 2026-06-02) linked only to order XTT.06-002 (state=cancelled);
// order cancellation never terminated the run, so assetNotBusy pinned
// vehicle 62H 05817 forever, hiding BOTH its paired drivers (LE VAN CHAU,
// NGUYEN HUU TAM) from the Tai xe dropdown while Dang chay showed nothing
// (it renders by ORDER state). The Jul-5 orphan guard missed this class:
// runHasLinkedOrder() checks link EXISTENCE, blind to the linked order
// state.
// Contract after GREEN:
//   busy = bound to a non-terminal road_run that has >=1 linked
//   transport_order in a NON-terminal state (both subsets derived from
//   the @fleet/domain FSMs, never hand-written). Runs whose orders are
//   all cancelled/completed free the pair; a run with a live order still
//   hides it (discriminating control seeded in the same tx).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ReferenceService } from '../src/reference/reference.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { roadRun, transportOrder, roadRunTransportOrder } from '../src/database/schema/transport.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
function tenancy(op: ReturnType<typeof createOperatorContext>): {
  companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
} {
  return {
    companyId: op.companyId, businessUnitId: op.businessUnitId,
    depotId: op.depotId, legalEntityId: op.legalEntityId,
  };
}
interface Seeded {
  readonly ghostOperatorId: string;
  readonly ghostVehicleId: string;
}
async function seedGhostAndLiveBusy(
  tx: Parameters<Parameters<typeof withTxIsolation>[1]>[0],
  op: ReturnType<typeof createOperatorContext>,
  ids: { ghostOp: string; liveOp: string; ghostPlate: string; livePlate: string },
): Promise<Seeded> {
  const [drvGhost] = await tx.insert(driver).values({
    ...tenancy(op), fullName: 'AAA GhostDrv', active: true, operatorId: ids.ghostOp,
  }).returning();
  const [drvLive] = await tx.insert(driver).values({
    ...tenancy(op), fullName: 'BBB LiveBusyDrv', active: true, operatorId: ids.liveOp,
  }).returning();
  const [vehGhost] = await tx.insert(vehicle).values({
    ...tenancy(op), plate: ids.ghostPlate, active: true,
  }).returning();
  const [vehLive] = await tx.insert(vehicle).values({
    ...tenancy(op), plate: ids.livePlate, active: true,
  }).returning();
  if (!drvGhost || !drvLive || !vehGhost || !vehLive) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values([
    { ...tenancy(op), driverId: drvGhost.driverId, vehicleId: vehGhost.vehicleId },
    { ...tenancy(op), driverId: drvLive.driverId, vehicleId: vehLive.vehicleId },
  ]);
  // GHOST: non-terminal (started) road_run whose ONLY linked order is cancelled
  // -- the exact prod shape of road_run dd964ecd / XTT.06-002.
  const [rrGhost] = await tx.insert(roadRun).values({
    ...tenancy(op), state: 'started',
    assignedOperatorId: ids.ghostOp, assignedAssetId: vehGhost.vehicleId,
  }).returning();
  const [orderCancelled] = await tx.insert(transportOrder).values({
    ...tenancy(op), state: 'cancelled', cancelledAt: new Date(),
  }).returning();
  if (!rrGhost || !orderCancelled) throw new Error('ghost seed failed');
  await tx.insert(roadRunTransportOrder).values({
    ...tenancy(op), roadRunId: rrGhost.roadRunId,
    transportOrderId: orderCancelled.transportOrderId, sequence: 1,
  });
  // LIVE BUSY control: non-terminal road_run WITH a live (non-terminal) order.
  const [rrLive] = await tx.insert(roadRun).values({
    ...tenancy(op), state: 'started',
    assignedOperatorId: ids.liveOp, assignedAssetId: vehLive.vehicleId,
  }).returning();
  const [orderLive] = await tx.insert(transportOrder).values({
    ...tenancy(op),
  }).returning();
  if (!rrLive || !orderLive) throw new Error('live-control seed failed');
  await tx.insert(roadRunTransportOrder).values({
    ...tenancy(op), roadRunId: rrLive.roadRunId,
    transportOrderId: orderLive.transportOrderId, sequence: 1,
  });
  return { ghostOperatorId: ids.ghostOp, ghostVehicleId: vehGhost.vehicleId };
}
describe('@fleet/api - ReferenceService frees pairs bound only to GHOST runs (all linked orders terminal)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('drivers(op) includes the ghost-bound driver and still hides the live-busy driver', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const seeded = await seedGhostAndLiveBusy(tx, op, {
        ghostOp: '00000000-0000-0000-0000-000000008001',
        liveOp: '00000000-0000-0000-0000-000000008002',
        ghostPlate: 'GHST-D-01', livePlate: 'LIVE-D-01',
      });
      return { items: (await svc.drivers(op)).items, seeded };
    });
    expect(result?.items).toEqual([
      { id: '00000000-0000-0000-0000-000000008001', label: 'AAA GhostDrv' },
    ]);
  });
  it('vehicles(op) includes the ghost-bound vehicle and still hides the live-busy vehicle', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const seeded = await seedGhostAndLiveBusy(tx, op, {
        ghostOp: '00000000-0000-0000-0000-000000009001',
        liveOp: '00000000-0000-0000-0000-000000009002',
        ghostPlate: 'AAA-GHST-V-01', livePlate: 'BBB-LIVE-V-01',
      });
      return { items: (await svc.vehicles(op)).items, seeded };
    });
    expect(result?.items).toEqual([
      { id: result?.seeded.ghostVehicleId, label: 'AAA-GHST-V-01' },
    ]);
  });
  it('driverVehicleAssignments(op) includes the ghost-bound pair and still hides the live-busy pair', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const seeded = await seedGhostAndLiveBusy(tx, op, {
        ghostOp: '00000000-0000-0000-0000-000000010001',
        liveOp: '00000000-0000-0000-0000-000000010002',
        ghostPlate: 'GHST-A-01', livePlate: 'LIVE-A-01',
      });
      return { items: (await svc.driverVehicleAssignments(op)).items, seeded };
    });
    expect(result?.items).toEqual([
      {
        operatorId: '00000000-0000-0000-0000-000000010001',
        vehicleId: result?.seeded.ghostVehicleId,
      },
    ]);
  });
});
