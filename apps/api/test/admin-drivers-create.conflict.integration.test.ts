// apps/api/test/admin-drivers-create.conflict.integration.test.ts
// RED (driver-create-conflict arc, 2026-07-06): AdminDriversCreateService
// does a BARE insert; duplicates hit 23505 -> unhandled -> HTTP 500 and the
// admin UI shows only the generic fallback. Prod incident: two soft-deleted
// LE VAN CHAU rows blocked re-registration with an opaque error.
// Contract (mirrors reference.service T5b/T5c reactivate-on-conflict):
//  - ACTIVE duplicate name  -> ConflictException, Vietnamese, names the field
//  - ACTIVE duplicate phone -> ConflictException, Vietnamese, names the field
//  - soft-deleted (active=false) name match -> REACTIVATE the row: same
//    driverId, SAME operatorId (passkey/JWT/audit continuity), active=true,
//    phone + passwordHash UPDATED to the new registration values
//  - soft-deleted phone match (different name spelling) -> same reactivate
//  - brand-new name+phone -> plain create (regression)
// Full unique constraints stay (DB-level race guard per 2026 practice);
// recovery rides the 23505 catch, never an app-level pre-check.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AdminDriversCreateService } from '../src/admin/admin-drivers-create.service.js';
import { driver } from '../src/database/schema/reference.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;
const fakeHash = (plain: string): Promise<string> => Promise.resolve('hashed:' + plain);

interface CreateInput {
  readonly fullName: string; readonly phone: string; readonly password: string;
  readonly companyId: string; readonly businessUnitId: string;
  readonly depotId: string; readonly legalEntityId: string;
}
function inputFor(op: ReturnType<typeof createOperatorContext>, fullName: string, phone: string, password: string): CreateInput {
  return {
    fullName, phone, password,
    companyId: op.companyId, businessUnitId: op.businessUnitId,
    depotId: op.depotId, legalEntityId: op.legalEntityId,
  };
}

describe('@fleet/api - AdminDriversCreateService conflict + reactivate', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });

  it('ACTIVE duplicate full name throws Vietnamese ConflictException naming the driver', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new AdminDriversCreateService(tx as never, fakeHash);
      const op = createOperatorContext();
      await svc.create(inputFor(op, 'LE VAN CHAU', '0913998879', 'pass-1234'));
      const attempt = svc.create(inputFor(op, 'LE VAN CHAU', '0854148878', 'pass-5678'));
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(/LE VAN CHAU/);
    });
  });

  it('ACTIVE duplicate phone throws Vietnamese ConflictException naming the phone', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new AdminDriversCreateService(tx as never, fakeHash);
      const op = createOperatorContext();
      await svc.create(inputFor(op, 'DRIVER ONE', '0900000111', 'pass-1234'));
      const attempt = svc.create(inputFor(op, 'DRIVER TWO', '0900000111', 'pass-5678'));
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(/0900000111/);
    });
  });

  it('soft-deleted name match REACTIVATES: same driverId + operatorId, new phone + password', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new AdminDriversCreateService(tx as never, fakeHash);
      const op = createOperatorContext();
      const original = await svc.create(inputFor(op, 'LE VAN CHAU', '0913998879', 'old-pass'));
      await tx.update(driver).set({ active: false })
        .where(and(eq(driver.companyId, op.companyId), eq(driver.driverId, original.driverId)));
      const reborn = await svc.create(inputFor(op, 'LE VAN CHAU', '0854148878', 'new-pass'));
      expect(reborn.driverId).toBe(original.driverId);
      expect(reborn.operatorId).toBe(original.operatorId);
      const [row] = await tx.select().from(driver)
        .where(eq(driver.driverId, original.driverId));
      expect(row?.active).toBe(true);
      expect(row?.phone).toBe('0854148878');
      expect(row?.passwordHash).toBe('hashed:new-pass');
    });
  });

  it('soft-deleted phone match (different name) REACTIVATES with the new name', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new AdminDriversCreateService(tx as never, fakeHash);
      const op = createOperatorContext();
      const original = await svc.create(inputFor(op, 'Le Van Chau', '0913830700', 'old-pass'));
      await tx.update(driver).set({ active: false })
        .where(and(eq(driver.companyId, op.companyId), eq(driver.driverId, original.driverId)));
      const reborn = await svc.create(inputFor(op, 'LE VAN CHAU 2', '0913830700', 'new-pass'));
      expect(reborn.driverId).toBe(original.driverId);
      expect(reborn.operatorId).toBe(original.operatorId);
      const [row] = await tx.select().from(driver)
        .where(eq(driver.driverId, original.driverId));
      expect(row?.active).toBe(true);
      expect(row?.fullName).toBe('LE VAN CHAU 2');
    });
  });

  it('brand-new name + phone creates normally (regression)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new AdminDriversCreateService(tx as never, fakeHash);
      const op = createOperatorContext();
      const row = await svc.create(inputFor(op, 'BRAND NEW DRIVER', '0999999999', 'pass-1234'));
      expect(row.driverId).toBeTruthy();
      expect(row.operatorId).toBeTruthy();
      expect(row.active).toBe(true);
    });
  });

  it('reactivated driver keeps exactly one row (no duplicate identity)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new AdminDriversCreateService(tx as never, fakeHash);
      const op = createOperatorContext();
      const original = await svc.create(inputFor(op, 'SINGLE ROW', '0911111111', 'old-pass'));
      await tx.update(driver).set({ active: false })
        .where(eq(driver.driverId, original.driverId));
      await svc.create(inputFor(op, 'SINGLE ROW', '0911111111', 'new-pass'));
      const rows = await tx.select().from(driver)
        .where(and(eq(driver.companyId, op.companyId), eq(driver.fullName, 'SINGLE ROW')));
      expect(rows.length).toBe(1);
    });
  });
});
