// apps/api/test/reference-vehicles-admin.integration.test.ts
// T5c RED: the reference admin page must list ALL active vehicles
// regardless of driver-vehicle pairing. The pair-filtered vehicles()
// query is for the dispatch create-order form. Adds vehiclesAdmin(op).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ReferenceService } from '../src/reference/reference.service.js';
import { vehicle } from '../src/database/schema/reference.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
describe('ReferenceService.vehiclesAdmin (T5c)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('returns all active vehicles regardless of driver-vehicle pairing', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const tn = {
        companyId: op.companyId, businessUnitId: op.businessUnitId,
        depotId: op.depotId, legalEntityId: op.legalEntityId,
      };
      await tx.insert(vehicle).values({ ...tn, plate: 'UNPAIRED-1' });
      const result = await svc.vehiclesAdmin(op);
      expect(result.items.map((i) => i.label)).toContain('UNPAIRED-1');
    });
  });
  it('excludes soft-deleted vehicles', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const tn = {
        companyId: op.companyId, businessUnitId: op.businessUnitId,
        depotId: op.depotId, legalEntityId: op.legalEntityId,
      };
      await tx.insert(vehicle).values({ ...tn, plate: 'GONE-1', active: false });
      const result = await svc.vehiclesAdmin(op);
      expect(result.items.map((i) => i.label)).not.toContain('GONE-1');
    });
  });
});
