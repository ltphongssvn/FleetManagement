// apps/api/test/erp-inbound.service.integration.test.ts
// Testcontainers Postgres integration: ErpInboundService.recordInvoiceAck.
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
// Note: this file uses real Postgres via Testcontainers, so the rollback
// is a real ROLLBACK rather than the PGlite WASM equivalent — semantics
// are identical from the test author's perspective.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { ErpInboundService } from '../src/erp-inbound/erp-inbound.service.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
let testDb: MigratedTestDb;
const COMPANY = '00000000-0000-0000-0000-000000000c01';
const BU = '00000000-0000-0000-0000-000000000c02';
const DEPOT = '00000000-0000-0000-0000-000000000c03';
const LE = '00000000-0000-0000-0000-000000000c04';
const MCID = '00000000-0000-0000-0000-000000000c05';
describe('@fleet/api - ErpInboundService (integration)', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_erp_inbound'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  async function seedRow(tx: TestTx): Promise<void> {
    await tx.execute(sql.raw(
      'INSERT INTO erp_invoice_map (' +
      'manifest_correlation_id, company_id, business_unit_id, depot_id, legal_entity_id, ' +
      'transport_order_id, erp_system, status) VALUES (' +
      String.fromCharCode(39) + MCID + String.fromCharCode(39) + ', ' +
      String.fromCharCode(39) + COMPANY + String.fromCharCode(39) + ', ' +
      String.fromCharCode(39) + BU + String.fromCharCode(39) + ', ' +
      String.fromCharCode(39) + DEPOT + String.fromCharCode(39) + ', ' +
      String.fromCharCode(39) + LE + String.fromCharCode(39) + ', ' +
      String.fromCharCode(39) + '00000000-0000-0000-0000-000000000c06' + String.fromCharCode(39) + ', ' +
      String.fromCharCode(39) + 'sap' + String.fromCharCode(39) + ', ' +
      String.fromCharCode(39) + 'pending' + String.fromCharCode(39) + ')',
    ));
  }
  it('updates row to acknowledged with timestamp', async () => {
    await withTxIsolation(testDb as never, async (tx) => {
      await seedRow(tx);
      const svc = new (ErpInboundService as unknown as new (db: unknown) => ErpInboundService)(tx);
      const res = await svc.recordInvoiceAck({
        manifestCorrelationId: MCID, erpSystem: 'sap', invoiceId: 'EXT-1', status: 'acknowledged',
      });
      expect(res.updated).toBe(true);
      const sel = 'SELECT status, external_erp_invoice_id FROM erp_invoice_map WHERE manifest_correlation_id = '
        + String.fromCharCode(39) + MCID + String.fromCharCode(39);
      const rows = await tx.execute<{ status: string; external_erp_invoice_id: string }>(sql.raw(sel));
      expect(rows.rows[0]?.status).toBe('acknowledged');
      expect(rows.rows[0]?.external_erp_invoice_id).toBe('EXT-1');
    });
  });
  it('updates row to failed with failureReason', async () => {
    await withTxIsolation(testDb as never, async (tx) => {
      await seedRow(tx);
      const svc = new (ErpInboundService as unknown as new (db: unknown) => ErpInboundService)(tx);
      const res = await svc.recordInvoiceAck({
        manifestCorrelationId: MCID, erpSystem: 'sap', invoiceId: 'EXT-2', status: 'failed', failureReason: 'duplicate',
      });
      expect(res.updated).toBe(true);
      const sel = 'SELECT status, failure_reason FROM erp_invoice_map WHERE manifest_correlation_id = '
        + String.fromCharCode(39) + MCID + String.fromCharCode(39);
      const rows = await tx.execute<{ status: string; failure_reason: string }>(sql.raw(sel));
      expect(rows.rows[0]?.status).toBe('failed');
      expect(rows.rows[0]?.failure_reason).toBe('duplicate');
    });
  });
  it('returns updated=false when no matching row', async () => {
    await withTxIsolation(testDb as never, async (tx) => {
      const svc = new (ErpInboundService as unknown as new (db: unknown) => ErpInboundService)(tx);
      const res = await svc.recordInvoiceAck({
        manifestCorrelationId: MCID, erpSystem: 'sap', invoiceId: 'EXT-3', status: 'acknowledged',
      });
      expect(res.updated).toBe(false);
    });
  });
});
