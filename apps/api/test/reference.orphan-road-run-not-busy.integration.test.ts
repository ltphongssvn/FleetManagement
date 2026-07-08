// apps/api/test/reference.orphan-road-run-not-busy.integration.test.ts
// RED-first (dispatch-pair-visibility arc, U1): an ORPHAN road_run -- a row
// in a non-terminal state (planned|dispatched|started) with ZERO linked
// transport_order via road_run_transport_order -- must NOT mark its pair
// busy. Real domain invariant: every legitimate road_run is created in the
// SAME transaction as its transport_order + link (transport-orders.service),
// so a link-less road_run cannot represent live work; it is an artifact
// (observed live 2026-07-05: E2E global-teardown deleted ALL company
// transport_orders while only deleting E2E-named road_runs, orphaning the
// pilot pair's run in 'planned' and hiding the idle pair from the dispatch
// form dropdowns So xe / Tai xe forever).
// Contract after GREEN:
//   busy = bound to a non-terminal road_run THAT HAS >=1 linked
//   transport_order. Orphan runs free the pair; linked non-terminal runs
//   still hide it (discriminating control seeded in the same tx).
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
  readonly orphanOperatorId: string;
  readonly orphanVehicleId: string;
}
async function seedOrphanAndLinkedBusy(
  tx: Parameters<Parameters<typeof withTxIsolation>[1]>[0],
  op: ReturnType<typeof createOperatorContext>,
  ids: { orphanOp: string; linkedOp: string; orphanPlate: string; linkedPlate: string },
): Promise<Seeded> {
  const [drvOrphan] = await tx.insert(driver).values({
    ...tenancy(op), fullName: 'AAA OrphanDrv', active: true, operatorId: ids.orphanOp,
  }).returning();
  const [drvLinked] = await tx.insert(driver).values({
    ...tenancy(op), fullName: 'BBB LinkedBusyDrv', active: true, operatorId: ids.linkedOp,
  }).returning();
  const [vehOrphan] = await tx.insert(vehicle).values({
    ...tenancy(op), plate: ids.orphanPlate, active: true,
  }).returning();
  const [vehLinked] = await tx.insert(vehicle).values({
    ...tenancy(op), plate: ids.linkedPlate, active: true,
  }).returning();
  if (!drvOrphan || !drvLinked || !vehOrphan || !vehLinked) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values([
    { ...tenancy(op), driverId: drvOrphan.driverId, vehicleId: vehOrphan.vehicleId },
    { ...tenancy(op), driverId: drvLinked.driverId, vehicleId: vehLinked.vehicleId },
  ]);
  // ORPHAN: non-terminal road_run, NO transport_order link anywhere.
  await tx.insert(roadRun).values({
    ...tenancy(op), state: 'planned',
    assignedOperatorId: ids.orphanOp, assignedAssetId: vehOrphan.vehicleId,
  });
  // LINKED BUSY control: non-terminal road_run WITH a linked order.
  const [rrLinked] = await tx.insert(roadRun).values({
    ...tenancy(op), state: 'planned',
    assignedOperatorId: ids.linkedOp, assignedAssetId: vehLinked.vehicleId,
  }).returning();
  const [order] = await tx.insert(transportOrder).values({
    ...tenancy(op),
  }).returning();
  if (!rrLinked || !order) throw new Error('busy-control seed failed');
  await tx.insert(roadRunTransportOrder).values({
    ...tenancy(op), roadRunId: rrLinked.roadRunId,
    transportOrderId: order.transportOrderId, sequence: 1,
  });
  return { orphanOperatorId: ids.orphanOp, orphanVehicleId: vehOrphan.vehicleId };
}
describe('@fleet/api - ReferenceService frees pairs bound only to ORPHAN road_runs', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('drivers(op) includes the orphan-bound driver and still hides the linked-busy driver', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const seeded = await seedOrphanAndLinkedBusy(tx, op, {
        orphanOp: '00000000-0000-0000-0000-000000005001',
        linkedOp: '00000000-0000-0000-0000-000000005002',
        orphanPlate: 'ORPH-D-01', linkedPlate: 'LINK-D-01',
      });
      return { items: (await svc.drivers(op)).items, seeded };
    });
    expect(result?.items).toEqual([
      { id: '00000000-0000-0000-0000-000000005001', label: 'AAA OrphanDrv' },
    ]);
  });
  it('vehicles(op) includes the orphan-bound vehicle and still hides the linked-busy vehicle', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const seeded = await seedOrphanAndLinkedBusy(tx, op, {
        orphanOp: '00000000-0000-0000-0000-000000006001',
        linkedOp: '00000000-0000-0000-0000-000000006002',
        orphanPlate: 'AAA-ORPH-V-01', linkedPlate: 'BBB-LINK-V-01',
      });
      return { items: (await svc.vehicles(op)).items, seeded };
    });
    expect(result?.items).toEqual([
      { id: result?.seeded.orphanVehicleId, label: 'AAA-ORPH-V-01' },
    ]);
  });
  it('driverVehicleAssignments(op) includes the orphan-bound pair and still hides the linked-busy pair', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const seeded = await seedOrphanAndLinkedBusy(tx, op, {
        orphanOp: '00000000-0000-0000-0000-000000007001',
        linkedOp: '00000000-0000-0000-0000-000000007002',
        orphanPlate: 'ORPH-A-01', linkedPlate: 'LINK-A-01',
      });
      return { items: (await svc.driverVehicleAssignments(op)).items, seeded };
    });
    expect(result?.items).toEqual([
      {
        operatorId: '00000000-0000-0000-0000-000000007001',
        vehicleId: result?.seeded.orphanVehicleId,
      },
    ]);
  });
});
