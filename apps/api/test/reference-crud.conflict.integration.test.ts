// apps/api/test/reference-crud.conflict.integration.test.ts
// T5b RED: ReferenceService MUST translate Postgres 23505 unique_violation
// into a NestJS ConflictException for every create* method. Without this,
// the controller returns HTTP 500 instead of HTTP 409 on duplicates.
//
// Isolation: per-test transaction via withTxIsolation. Each test inserts a
// row, then re-inserts the same key and asserts ConflictException.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ReferenceService } from '../src/reference/reference.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
describe('@fleet/api - ReferenceService duplicate -> ConflictException (T5b)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('createCustomer duplicate name throws ConflictException', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await svc.createCustomer(op, 'DupCo');
      await expect(svc.createCustomer(op, 'DupCo')).rejects.toBeInstanceOf(ConflictException);
    });
  });
  it('createCargoType duplicate name throws ConflictException', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await svc.createCargoType(op, 'DupCargo');
      await expect(svc.createCargoType(op, 'DupCargo')).rejects.toBeInstanceOf(ConflictException);
    });
  });
  it('createVehicle duplicate plate throws ConflictException', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await svc.createVehicle(op, '99H-99999');
      await expect(svc.createVehicle(op, '99H-99999')).rejects.toBeInstanceOf(ConflictException);
    });
  });
  it('createWarehouse duplicate name+role throws ConflictException', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await svc.createWarehouse(op, 'DupHouse', 'pickup');
      await expect(svc.createWarehouse(op, 'DupHouse', 'pickup')).rejects.toBeInstanceOf(ConflictException);
    });
  });
  it('createWarehouse same name but different role does NOT conflict', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await svc.createWarehouse(op, 'SameName', 'pickup');
      // Different role is a different unique key tuple; must succeed.
      const ok = await svc.createWarehouse(op, 'SameName', 'delivery');
      expect(ok.label).toBe('SameName');
    });
  });
});
