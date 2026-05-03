// apps/api/test/erp-inbound.service.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { ErpInboundService } from '../src/erp-inbound/erp-inbound.service.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;
const COMPANY = '00000000-0000-0000-0000-000000000c01';
const BU = '00000000-0000-0000-0000-000000000c02';
const DEPOT = '00000000-0000-0000-0000-000000000c03';
const LE = '00000000-0000-0000-0000-000000000c04';
const MCID = '00000000-0000-0000-0000-000000000c05';

describe('@fleet/api - ErpInboundService (integration)', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_erp_inbound'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => { await testDb.db.execute(sql`TRUNCATE TABLE erp_invoice_map CASCADE`); });

  async function seedRow(): Promise<void> {
    await testDb.db.execute(sql`
      INSERT INTO erp_invoice_map (
        manifest_correlation_id, company_id, business_unit_id, depot_id, legal_entity_id,
        transport_order_id, erp_system, status
      ) VALUES (
        ${MCID}, ${COMPANY}, ${BU}, ${DEPOT}, ${LE},
        '00000000-0000-0000-0000-000000000c06', 'sap', 'pending'
      )
    `);
  }

  it('updates row to acknowledged with timestamp', async () => {
    await seedRow();
    const svc = new (ErpInboundService as unknown as new (db: unknown) => ErpInboundService)(testDb.db);
    const res = await svc.recordInvoiceAck({
      manifestCorrelationId: MCID, erpSystem: 'sap', invoiceId: 'EXT-1', status: 'acknowledged',
    });
    expect(res.updated).toBe(true);
    const rows = await testDb.db.execute<{ status: string; external_erp_invoice_id: string }>(sql`
      SELECT status, external_erp_invoice_id FROM erp_invoice_map WHERE manifest_correlation_id = ${MCID}
    `);
    expect(rows.rows[0]?.status).toBe('acknowledged');
    expect(rows.rows[0]?.external_erp_invoice_id).toBe('EXT-1');
  });

  it('updates row to failed with failureReason', async () => {
    await seedRow();
    const svc = new (ErpInboundService as unknown as new (db: unknown) => ErpInboundService)(testDb.db);
    const res = await svc.recordInvoiceAck({
      manifestCorrelationId: MCID, erpSystem: 'sap', invoiceId: 'EXT-2', status: 'failed', failureReason: 'duplicate',
    });
    expect(res.updated).toBe(true);
    const rows = await testDb.db.execute<{ status: string; failure_reason: string }>(sql`
      SELECT status, failure_reason FROM erp_invoice_map WHERE manifest_correlation_id = ${MCID}
    `);
    expect(rows.rows[0]?.status).toBe('failed');
    expect(rows.rows[0]?.failure_reason).toBe('duplicate');
  });

  it('returns updated=false when no matching row', async () => {
    const svc = new (ErpInboundService as unknown as new (db: unknown) => ErpInboundService)(testDb.db);
    const res = await svc.recordInvoiceAck({
      manifestCorrelationId: MCID, erpSystem: 'sap', invoiceId: 'EXT-3', status: 'acknowledged',
    });
    expect(res.updated).toBe(false);
  });
});
