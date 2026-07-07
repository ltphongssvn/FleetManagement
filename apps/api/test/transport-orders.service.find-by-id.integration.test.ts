// apps/api/test/transport-orders.service.find-by-id.integration.test.ts
// RED: PGlite integration tests for TransportOrdersService.findById.
// withTxIsolation swallows thrown errors via .catch(()=>{}). We capture
// the result / error into outer-scope variables and assert AFTER the helper
// returns so negative-path tests actually fail when findById does NOT throw.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { TransportOrderNotFoundError } from '../src/transport-orders/transport-orders.errors.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import type { ListAssignedRow } from '../src/transport-orders/transport-orders.dto.js';
let testDb: PgliteTestDb;
async function seedActivePair(tx: TestTx, op: ReturnType<typeof createOperatorContext>): Promise<{ operatorId: string; vehicleId: string }> {
  const operatorId = op.operatorId;
  const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'FB', operatorId }).returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'FB-' + randomUUID().slice(0,4) }).returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId, vehicleId: v.vehicleId };
}
describe('@fleet/api - TransportOrdersService.findById (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('returns the enriched row for an order in the calling tenancy', async () => {
    let row: ListAssignedRow | undefined;
    let createdId: string | undefined;
    let thrown: unknown;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await svc.create({
        externalRef: 'TO-FB-1',
        stops: [
          { sequence: 1, stopType: 'pickup', plannedAt: '2026-05-01T08:00:00.000Z' },
          { sequence: 2, stopType: 'dropoff' },
        ],
        roadRun: { plannedStartAt: '2026-05-01T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      createdId = created.transportOrderId;
      try { row = await svc.findById(created.transportOrderId, op); } catch (e) { thrown = e; }
    });
    expect(thrown).toBeUndefined();
    expect(row).toBeDefined();
    if (row === undefined) throw new Error('row undefined');
    if (createdId === undefined) throw new Error('createdId undefined');
    expect(row.transportOrderId).toBe(createdId);
    // T3: external_ref is server-assigned (XTT.MM-NNN, 2026-Q2 format), not the client-supplied value.
    expect(row.externalRef).toMatch(/^XTT\.(0[1-9]|1[0-2])-\d{3,}$/);
    expect(row.state).toBe('planned');
    expect(row.plannedStartAt).toBe('2026-05-01T07:00:00.000Z');
    expect(row.stops).toHaveLength(2);
    expect(row.stops[0]).toEqual({ sequence: 1, stopType: 'pickup', plannedAt: '2026-05-01T08:00:00.000Z', warehouseName: null, arrivedAt: null, departedAt: null });
    // T9: review producer serializes arrived/departed timestamps once set.
    let row2: Awaited<ReturnType<TransportOrdersService['findById']>> | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const c = await svc.create({
        externalRef: 'TO-AT-1',
        stops: [{ sequence: 1, stopType: 'pickup', plannedAt: '2026-05-01T08:00:00.000Z' }],
        roadRun: { plannedStartAt: '2026-05-01T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      await tx.execute(sql.raw(
        "UPDATE stop SET arrived_at = '2026-05-01T10:00:00.000Z', departed_at = '2026-05-01T10:30:00.000Z' WHERE transport_order_id = '" + c.transportOrderId + "'"
      ));
      row2 = await svc.findById(c.transportOrderId, op);
    });
    expect(row2?.stops[0]?.arrivedAt).toBe('2026-05-01T10:00:00.000Z');
    expect(row2?.stops[0]?.departedAt).toBe('2026-05-01T10:30:00.000Z');
  });
  it('throws TransportOrderNotFoundError for an unknown id', async () => {
    let thrown: unknown;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      try { await svc.findById('00000000-0000-0000-0000-000000000000', op); } catch (e) { thrown = e; }
    });
    expect(thrown).toBeInstanceOf(TransportOrderNotFoundError);
  });
  it('throws TransportOrderNotFoundError when the order is in a different company', async () => {
    let thrown: unknown;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op1 = createOperatorContext({ companyId: '00000000-0000-0000-0000-00000000aaaa' });
      const op2 = createOperatorContext({ companyId: '00000000-0000-0000-0000-00000000bbbb' });
      const { operatorId, vehicleId } = await seedActivePair(tx, op1);
      const created = await svc.create({
        externalRef: 'TO-FB-TENANT',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op1);
      try { await svc.findById(created.transportOrderId, op2); } catch (e) { thrown = e; }
    });
    expect(thrown).toBeInstanceOf(TransportOrderNotFoundError);
  });
});
