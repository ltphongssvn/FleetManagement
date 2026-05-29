// apps/api/test/reference-crud.service.integration.test.ts
// PGlite integration: ReferenceService CRUD methods for the dispatch-form
// master data — create / rename / soft-delete for customer, cargoType,
// vehicle and warehouse. Soft delete sets active=false so existing orders
// keep their reference intact; list methods already exclude inactive rows.
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
//
// Note (2026-Q2 invariant): ReferenceService.vehicles() returns ONLY
// vehicles that participate in an active driver_vehicle_assignment. To
// round-trip a bare vehicle, the test queries the schema table directly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { ReferenceService } from '../src/reference/reference.service.js';
import { vehicle } from '../src/database/schema/reference.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
describe('@fleet/api - ReferenceService CRUD (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 30_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('createCustomer / updateCustomer / deleteCustomer round-trip', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createCustomer(op, 'Acme');
      expect(created.label).toBe('Acme');
      expect((await svc.customers(op)).items.map((i) => i.label)).toEqual(['Acme']);
      await svc.updateCustomer(op, created.id, 'Acme Corp');
      expect((await svc.customers(op)).items.map((i) => i.label)).toEqual(['Acme Corp']);
      await svc.deleteCustomer(op, created.id);
      expect((await svc.customers(op)).items).toEqual([]);
    });
  });
  it('createCargoType / updateCargoType / deleteCargoType round-trip', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createCargoType(op, 'Rice');
      await svc.updateCargoType(op, created.id, 'Jasmine Rice');
      expect((await svc.cargoTypes(op)).items.map((i) => i.label)).toEqual(['Jasmine Rice']);
      await svc.deleteCargoType(op, created.id);
      expect((await svc.cargoTypes(op)).items).toEqual([]);
    });
  });
  it('createVehicle / updateVehicle / deleteVehicle round-trip via underlying table', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createVehicle(op, '62H-05800');
      const readActive = async (): Promise<string[]> =>
        (await tx.select({ plate: vehicle.plate, active: vehicle.active }).from(vehicle)
          .where(and(eq(vehicle.companyId, op.companyId), eq(vehicle.active, true)))
          .orderBy(asc(vehicle.plate))).map((r) => r.plate);
      expect(await readActive()).toEqual(['62H-05800']);
      await svc.updateVehicle(op, created.id, '62H-05801');
      expect(await readActive()).toEqual(['62H-05801']);
      await svc.deleteVehicle(op, created.id);
      expect(await readActive()).toEqual([]);
    });
  });
  it('createWarehouse / updateWarehouse / deleteWarehouse round-trip, role preserved', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createWarehouse(op, 'North Dock', 'pickup');
      expect((await svc.warehouses(op, 'pickup')).items.map((i) => i.label)).toEqual(['North Dock']);
      await svc.updateWarehouse(op, created.id, 'North Depot');
      expect((await svc.warehouses(op, 'pickup')).items.map((i) => i.label)).toEqual(['North Depot']);
      await svc.deleteWarehouse(op, created.id);
      expect((await svc.warehouses(op, 'pickup')).items).toEqual([]);
    });
  });
  it('createWarehouse supports the delivery role', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await svc.createWarehouse(op, 'South Bay', 'delivery');
      expect((await svc.warehouses(op, 'delivery')).items.map((i) => i.label)).toEqual(['South Bay']);
      expect((await svc.warehouses(op, 'pickup')).items).toEqual([]);
    });
  });
  it('create methods isolate by company_id', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op1 = createOperatorContext();
      const op2 = createOperatorContext();
      await svc.createCustomer(op1, 'Owned');
      await svc.createCustomer(op2, 'Other Co');
      expect((await svc.customers(op1)).items.map((i) => i.label)).toEqual(['Owned']);
    });
  });
});
