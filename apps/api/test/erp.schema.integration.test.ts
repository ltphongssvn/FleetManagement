// apps/api/test/erp.schema.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;

const TENANT = {
  company_id: '00000000-0000-0000-0000-000000000003',
  business_unit_id: '00000000-0000-0000-0000-000000000004',
  depot_id: '00000000-0000-0000-0000-000000000005',
  legal_entity_id: '00000000-0000-0000-0000-000000000006',
};

describe('@fleet/api - ERP schema (integration)', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test');
  }, 90_000);

  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });

  beforeEach(async () => {
    await truncateAllTables(testDb.db);
  });

  it('rejects duplicate (company, erpSystem, internalCustomerId) mapping', async () => {
    await testDb.db.execute(sql`
      INSERT INTO erp_customer_map (company_id, business_unit_id, depot_id, legal_entity_id, internal_customer_id, external_erp_id, erp_system)
      VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, 'ERP-1', 'sap')
    `);
    await expect(
      testDb.db.execute(sql`
        INSERT INTO erp_customer_map (company_id, business_unit_id, depot_id, legal_entity_id, internal_customer_id, external_erp_id, erp_system)
        VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, 'ERP-2', 'sap')
      `),
    ).rejects.toThrow();
  });

  it('rejects duplicate invoice (manifestCorrelationId, erpSystem)', async () => {
    const tx = `
      INSERT INTO erp_invoice_map (company_id, business_unit_id, depot_id, legal_entity_id, manifest_correlation_id, transport_order_id, erp_system)
      VALUES ('${TENANT.company_id}'::uuid, '${TENANT.business_unit_id}'::uuid, '${TENANT.depot_id}'::uuid, '${TENANT.legal_entity_id}'::uuid,
              '00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, 'sap')
    `;
    await testDb.db.execute(sql.raw(tx));
    await expect(testDb.db.execute(sql.raw(tx))).rejects.toThrow();
  });

  it('allows same internal customer in different ERP systems', async () => {
    const internalId = '00000000-0000-0000-0000-0000000000d1';
    await testDb.db.execute(sql`
      INSERT INTO erp_customer_map (company_id, business_unit_id, depot_id, legal_entity_id, internal_customer_id, external_erp_id, erp_system)
      VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${internalId}::uuid, 'ERP-A', 'sap')
    `);
    await expect(
      testDb.db.execute(sql`
        INSERT INTO erp_customer_map (company_id, business_unit_id, depot_id, legal_entity_id, internal_customer_id, external_erp_id, erp_system)
        VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${internalId}::uuid, 'ERP-B', 'oracle')
      `),
    ).resolves.toBeDefined();
  });
});
