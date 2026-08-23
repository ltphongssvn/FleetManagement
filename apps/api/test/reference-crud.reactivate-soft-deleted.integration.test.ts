// apps/api/test/reference-crud.reactivate-soft-deleted.integration.test.ts
// T5c RED: when a dispatcher re-adds a name that was soft-deleted
// (active=false), the create* methods MUST reactivate the existing row
// (set active=true) and return its label — NOT throw ConflictException.
// Dispatcher mental model: 'add it back', not 'permanent uniqueness
// barrier'. The unique constraint is invisible to them.
//
// Conflict still fires only when an ACTIVE row with the same key exists.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { ReferenceService } from '../src/reference/reference.service.js';
import { customer, cargoType, vehicle, warehouse } from '../src/database/schema/reference.js';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
describe('@fleet/api - ReferenceService re-add reactivates soft-deleted rows (T5c)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  it('createCustomer reactivates a soft-deleted row instead of throwing', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createCustomer(op, 'ReAct');
      await svc.deleteCustomer(op, created.id);
      // re-add: must NOT throw, must return the same name, row is active again
      const reborn = await svc.createCustomer(op, 'ReAct');
      expect(reborn.label).toBe('ReAct');
      const [row] = await tx
        .select({ active: customer.active })
        .from(customer)
        .where(and(eq(customer.companyId, op.companyId), eq(customer.customerId, reborn.id)));
      expect(row?.active).toBe(true);
      expect((await svc.customers(op)).items.map((i) => i.label)).toEqual(['ReAct']);
    });
  });
  it('createCustomer still throws ConflictException when an ACTIVE row exists', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await svc.createCustomer(op, 'StillActive');
      await expect(svc.createCustomer(op, 'StillActive')).rejects.toBeInstanceOf(ConflictException);
    });
  });
  it('createCargoType reactivates a soft-deleted row', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createCargoType(op, 'TẤM');
      await svc.deleteCargoType(op, created.id);
      const reborn = await svc.createCargoType(op, 'TẤM');
      expect(reborn.label).toBe('TẤM');
      const [row] = await tx
        .select({ active: cargoType.active })
        .from(cargoType)
        .where(and(eq(cargoType.companyId, op.companyId), eq(cargoType.cargoTypeId, reborn.id)));
      expect(row?.active).toBe(true);
    });
  });
  it('createVehicle reactivates a soft-deleted row', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createVehicle(op, '99H-RA1');
      await svc.deleteVehicle(op, created.id);
      const reborn = await svc.createVehicle(op, '99H-RA1');
      expect(reborn.label).toBe('99H-RA1');
      const [row] = await tx
        .select({ active: vehicle.active })
        .from(vehicle)
        .where(and(eq(vehicle.companyId, op.companyId), eq(vehicle.vehicleId, reborn.id)));
      expect(row?.active).toBe(true);
    });
  });
  it('createWarehouse reactivates a soft-deleted row keyed by (name, role)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createWarehouse(op, 'ReHouse', 'pickup');
      await svc.deleteWarehouse(op, created.id);
      const reborn = await svc.createWarehouse(op, 'ReHouse', 'pickup');
      expect(reborn.label).toBe('ReHouse');
      const [row] = await tx
        .select({ active: warehouse.active })
        .from(warehouse)
        .where(and(eq(warehouse.companyId, op.companyId), eq(warehouse.warehouseId, reborn.id)));
      expect(row?.active).toBe(true);
    });
  });
});
