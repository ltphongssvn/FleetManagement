// apps/api/test/reference.service.integration.test.ts
// PGlite integration: exercises every ReferenceService method and branch —
// list methods (drivers/vehicles/customers/cargoTypes/warehouses) with the
// company_id + active filter and inactive-row exclusion; peekOrderRef with
// a present row AND the no-row ?? fallback; allocateOrderRef both the
// insert-when-absent and update-existing paths; warehouses role filter.
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
// allocateOrderRef calls this.db.transaction(...).for('update') internally;
// under tx-injection that becomes a SAVEPOINT + row-level lock within the
// outer test tx, which PGlite handles correctly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ReferenceService } from '../src/reference/reference.service.js';
import {
  driver, vehicle, customer, cargoType, warehouse,
} from '../src/database/schema/reference.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
function tenancy(op: ReturnType<typeof createOperatorContext>): {
  companyId: string; businessUnitId: string;
  depotId: string; legalEntityId: string;
} {
  return {
    companyId: op.companyId,
    businessUnitId: op.businessUnitId,
    depotId: op.depotId,
    legalEntityId: op.legalEntityId,
  };
}
describe('@fleet/api - ReferenceService (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 30_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('drivers() returns active drivers for the company, excludes inactive', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await tx.insert(driver).values([
        { ...tenancy(op), fullName: 'Bravo', active: true, operatorId: '00000000-0000-0000-0000-0000000000b1' },
        { ...tenancy(op), fullName: 'Alpha', active: true, operatorId: '00000000-0000-0000-0000-0000000000a1' },
        { ...tenancy(op), fullName: 'Inactive One', active: false, operatorId: '00000000-0000-0000-0000-0000000000c1' },
      ]);
      const res = await svc.drivers(op);
      expect(res.items.map((i) => i.label)).toEqual(['Alpha', 'Bravo']);
    });
  });
  it('drivers() exposes operatorId as the option id (used as assignedOperatorId)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const opAlpha = '00000000-0000-0000-0000-0000000000a1';
      const opBravo = '00000000-0000-0000-0000-0000000000b2';
      await tx.insert(driver).values([
        { ...tenancy(op), fullName: 'Alpha', active: true, operatorId: opAlpha },
        { ...tenancy(op), fullName: 'Bravo', active: true, operatorId: opBravo },
      ]);
      const res = await svc.drivers(op);
      const byLabel = Object.fromEntries(res.items.map((i) => [i.label, i.id]));
      expect(byLabel['Alpha']).toBe(opAlpha);
      expect(byLabel['Bravo']).toBe(opBravo);
    });
  });
  it('vehicles() returns active vehicles ordered by plate', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await tx.insert(vehicle).values([
        { ...tenancy(op), plate: 'ZZ-99', active: true },
        { ...tenancy(op), plate: 'AA-01', active: true },
        { ...tenancy(op), plate: 'XX-00', active: false },
      ]);
      const res = await svc.vehicles(op);
      expect(res.items.map((i) => i.label)).toEqual(['AA-01', 'ZZ-99']);
    });
  });
  it('customers() returns active customers ordered by name', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await tx.insert(customer).values([
        { ...tenancy(op), name: 'Zenith', active: true },
        { ...tenancy(op), name: 'Acme', active: true },
        { ...tenancy(op), name: 'Defunct', active: false },
      ]);
      const res = await svc.customers(op);
      expect(res.items.map((i) => i.label)).toEqual(['Acme', 'Zenith']);
    });
  });
  it('cargoTypes() returns active cargo types ordered by name', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await tx.insert(cargoType).values([
        { ...tenancy(op), name: 'Reefer', active: true },
        { ...tenancy(op), name: 'Dry Van', active: true },
        { ...tenancy(op), name: 'Retired', active: false },
      ]);
      const res = await svc.cargoTypes(op);
      expect(res.items.map((i) => i.label)).toEqual(['Dry Van', 'Reefer']);
    });
  });
  it('warehouses() filters by role', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await tx.insert(warehouse).values([
        { ...tenancy(op), name: 'North Dock', active: true, role: 'pickup' },
        { ...tenancy(op), name: 'South Bay', active: true, role: 'delivery' },
        { ...tenancy(op), name: 'Closed Yard', active: false, role: 'pickup' },
      ]);
      const pickup = await svc.warehouses(op, 'pickup');
      expect(pickup.items.map((i) => i.label)).toEqual(['North Dock']);
      const delivery = await svc.warehouses(op, 'delivery');
      expect(delivery.items.map((i) => i.label)).toEqual(['South Bay']);
    });
  });
  it('list methods isolate by company_id', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op1 = createOperatorContext();
      const op2 = createOperatorContext();
      await tx.insert(driver).values([
        { ...tenancy(op1), fullName: 'Owned', active: true, operatorId: '00000000-0000-0000-0000-0000000000d1' },
        { ...tenancy(op2), fullName: 'Other Co', active: true, operatorId: '00000000-0000-0000-0000-0000000000e2' },
      ]);
      const res = await svc.drivers(op1);
      expect(res.items.map((i) => i.label)).toEqual(['Owned']);
    });
  });
  it('peekOrderRef() uses ?? fallbacks when no order_sequence row exists', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const res = await svc.peekOrderRef(op, 'TO');
      expect(res.ref).toBe('TO.001');
    });
  });
  it('allocateOrderRef() inserts a new sequence row on first call, then peek reflects it', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const first = await svc.allocateOrderRef(op, 'TO');
      expect(first.ref).toBe('TO.001');
      const peek = await svc.peekOrderRef(op, 'TO');
      expect(peek.ref).toBe('TO.002');
    });
  });
  it('allocateOrderRef() increments an existing sequence row across calls', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const a = await svc.allocateOrderRef(op, 'TO');
      const b = await svc.allocateOrderRef(op, 'TO');
      const c = await svc.allocateOrderRef(op, 'TO');
      expect([a.ref, b.ref, c.ref]).toEqual(['TO.001', 'TO.002', 'TO.003']);
    });
  });
});
