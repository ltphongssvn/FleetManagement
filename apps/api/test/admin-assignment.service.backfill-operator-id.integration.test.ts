// apps/api/test/admin-assignment.service.backfill-operator-id.integration.test.ts
// T5e (RED): AdminAssignmentService.assign MUST guarantee the assigned
// driver has a non-null operator_id. Without one the dispatch
// ReferenceService.driverVehicleAssignments query (which filters
// isNotNull(driver.operatorId)) drops the row, and the dispatch
// CreateOrderForm Section 3 (Số xe / Tài xế) ends up empty even when
// the admin page shows the pair as active.
//
// Critical user journey: dispatcher creates an order using a vehicle
// that admin just paired with a driver. The dropdowns MUST surface that
// pair immediately.
//
// Business invariant: every active driver_vehicle_assignment is visible
// in the dispatch create-order Số xe / Tài xế dropdowns.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { AdminAssignmentService } from '../src/admin/admin-assignment.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
describe('AdminAssignmentService.assign backfills operator_id (T5e)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 30_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('sets driver.operator_id when the driver was created without one', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new AdminAssignmentService(tx as never);
      const op = createOperatorContext();
      const tn = {
        companyId: op.companyId, businessUnitId: op.businessUnitId,
        depotId: op.depotId, legalEntityId: op.legalEntityId,
      };
      const [d] = await tx.insert(driver).values({ ...tn, fullName: 'TEST DRIVER 1' }).returning();
      const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'TEST-1' }).returning();
      if (!d || !v) throw new Error('seed failed');
      expect(d.operatorId).toBeNull();
      await svc.assign({ driverId: d.driverId, vehicleId: v.vehicleId, ...tn });
      const [after] = await tx.select().from(driver).where(eq(driver.driverId, d.driverId));
      expect(after?.operatorId).not.toBeNull();
      expect(after?.operatorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });
  it('leaves a pre-existing operator_id untouched', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new AdminAssignmentService(tx as never);
      const op = createOperatorContext();
      const tn = {
        companyId: op.companyId, businessUnitId: op.businessUnitId,
        depotId: op.depotId, legalEntityId: op.legalEntityId,
      };
      const existingOp = '00000000-0000-0000-0000-0000000000aa';
      const [d] = await tx.insert(driver).values({ ...tn, fullName: 'TEST DRIVER 2', operatorId: existingOp }).returning();
      const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'TEST-2' }).returning();
      if (!d || !v) throw new Error('seed failed');
      await svc.assign({ driverId: d.driverId, vehicleId: v.vehicleId, ...tn });
      const [after] = await tx.select().from(driver).where(eq(driver.driverId, d.driverId));
      expect(after?.operatorId).toBe(existingOp);
    });
  });
});
