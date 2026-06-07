// apps/api/test/reference-crud.customer-phone.integration.test.ts
// L4 (PGlite integration): customer Số điện thoại persistence. createCustomer
// accepts an optional VN domestic phone (e.g. 0901234567, no +84); customers()
// surfaces it as meta.phone; updateCustomer changes it. RED first: the current
// service signatures take only name and customers() returns no meta.phone.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ReferenceService } from '../src/reference/reference.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
describe('@fleet/api - ReferenceService customer phone (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 30_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('createCustomer persists phone and customers() surfaces it via meta.phone', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createCustomer(op, 'Acme', '0901234567');
      expect(created.label).toBe('Acme');
      const items = (await svc.customers(op)).items;
      expect(items.map((i) => i.label)).toEqual(['Acme']);
      expect(items[0]?.meta?.['phone']).toBe('0901234567');
    });
  });
  it('createCustomer without phone stores null (phone optional)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      await svc.createCustomer(op, 'NoPhone');
      const items = (await svc.customers(op)).items;
      expect(items[0]?.meta?.['phone'] ?? null).toBeNull();
    });
  });
  it('updateCustomer changes the phone (and can keep the name)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createCustomer(op, 'Acme', '0901111111');
      await svc.updateCustomer(op, created.id, 'Acme', '0902222222');
      const items = (await svc.customers(op)).items;
      expect(items[0]?.label).toBe('Acme');
      expect(items[0]?.meta?.['phone']).toBe('0902222222');
    });
  });
  it('updateCustomer with empty-string phone clears it to null', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const created = await svc.createCustomer(op, 'Acme', '0901111111');
      await svc.updateCustomer(op, created.id, 'Acme', '');
      const items = (await svc.customers(op)).items;
      expect(items[0]?.meta?.['phone'] ?? null).toBeNull();
    });
  });
});
