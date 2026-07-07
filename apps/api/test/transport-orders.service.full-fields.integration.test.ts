// apps/api/test/transport-orders.service.full-fields.integration.test.ts
// PGlite integration: every optional field is set on create and round-trips
// through listAssigned. The road_run carries both an assignedOperatorId and
// an assignedAssetId, so the driver-vehicle pair guard in
// TransportOrdersService requires an active driver_vehicle_assignment row
// for the (driver, vehicle) pair — seeded explicitly inside the test tx.
//
// Isolation: tx-injection (Probe 4 pattern). Each it() runs inside one
// drizzle transaction; the SUT is built with `tx` so its
// this.db.transaction(...) call lands as a SAVEPOINT under ours; the outer
// tx is rolled back at the end. No TRUNCATE needed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
describe('@fleet/api - TransportOrdersService (all optional fields populated)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('create populates every optional field, listAssigned returns it with mixed stops', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const customerId = randomUUID();
      const yardId = randomUUID();
      const assetId = randomUUID();
      const tn = {
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
      };
      await tx.insert(vehicle).values({ ...tn, vehicleId: assetId, plate: 'FF-001' });
      const [dRow] = await tx.insert(driver)
        .values({ ...tn, fullName: 'FF-DRIVER', operatorId: op.operatorId })
        .returning({ driverId: driver.driverId });
      if (!dRow) throw new Error('seed failed');
      await tx.insert(driverVehicleAssignment)
        .values({ ...tn, driverId: dRow.driverId, vehicleId: assetId });
      const result = await svc.create({
        // externalRef intentionally omitted — server assigns XTT.MM-NNN authoritatively (T3, 2026)
        customerId,
        metadata: { priority: 'high', note: 'full-fields path' },
        stops: [
          { sequence: 1, stopType: 'pickup', yardId, plannedAt: '2026-06-01T09:00:00.000Z' },
          { sequence: 2, stopType: 'dropoff' },
        ],
        roadRun: {
          plannedStartAt: '2026-06-01T08:00:00.000Z',
          assignedOperatorId: op.operatorId,
          assignedAssetId: assetId,
        },
      }, op);
      expect(result.transportOrderId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(result.roadRunId).toMatch(/^[0-9a-f-]{36}$/i);
      const list = await svc.listAssigned(op);
      expect(list.rows).toHaveLength(1);
      const row = list.rows[0];
      expect(row?.externalRef).toMatch(/^XTT\.[0-9]{2}-[0-9]{3,}$/);
      expect(row?.plannedStartAt).toBe('2026-06-01T08:00:00.000Z');
      expect(row?.stops).toHaveLength(2);
      expect(row?.stops[0]?.plannedAt).toBe('2026-06-01T09:00:00.000Z');
      expect(row?.stops[1]?.plannedAt).toBeNull();
    });
  });
});
