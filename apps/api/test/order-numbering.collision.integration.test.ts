// apps/api/test/order-numbering.collision.integration.test.ts
// RED then GREEN: OrderNumberingService must not collide with pre-existing
// transport_order.external_ref rows for the current month + prefix. The
// 2026-Q2 format change (XT.NNNN -> XTT.MM-NNN, per-month sequence) means
// old XT.NNNN rows are in a different namespace and CAN coexist, but new
// XTT.MM-NNN rows from a prior import / manual SQL / snapshot reload can
// still cause the next allocation to collide on
// transport_order_company_external_ref_uq.
//
// The GREEN production change must satisfy: allocate() returns a string
// whose numeric NNN part is strictly greater than any existing
// transport_order.external_ref matching prefix.MM- in the same company.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { OrderNumberingService, DEFAULT_ORDER_PREFIX } from '../src/transport-orders/order-numbering.service.js';
import { transportOrder } from '../src/database/schema/transport.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
const OP = createOperatorContext();
const MONTHLY_REGEX = /^XTT\.(0[1-9]|1[0-2])-(\d+)$/;
const FIXED_NOW = new Date('2026-06-15T10:00:00Z');
function tenancyOf(): { companyId: string; businessUnitId: string; depotId: string; legalEntityId: string } {
  return {
    companyId: OP.companyId, businessUnitId: OP.businessUnitId,
    depotId: OP.depotId, legalEntityId: OP.legalEntityId,
  };
}
function parseMonthlyNumber(ref: string): number {
  const m = MONTHLY_REGEX.exec(ref);
  if (m?.[2] === undefined) throw new Error('not XTT.MM-NNN: ' + ref);
  return parseInt(m[2], 10);
}
async function seedExistingMonthlyRefs(tx: TestTx, month: number, count: number): Promise<void> {
  const tn = tenancyOf();
  const mm = month < 10 ? '0' + String(month) : String(month);
  for (let i = 1; i <= count; i++) {
    const ref = 'XTT.' + mm + '-' + String(i).padStart(3, '0');
    await tx.insert(transportOrder).values({ ...tn, externalRef: ref });
  }
}
function requireDefined<T>(v: T | undefined | null, label: string): T {
  if (v === undefined || v === null) throw new Error(label + ' was undefined/null');
  return v;
}
describe('@fleet/api - OrderNumberingService legacy-data collision (T3 hardening)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('legacy XT.NNNN rows live in a different namespace and do not affect XTT.MM-NNN allocation', async () => {
    let allocated: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const tn = tenancyOf();
      // Seed legacy global-format rows. They share neither the prefix nor
      // the regex shape with XTT.MM-NNN, so the rebase MAX query must not
      // see them and the new allocator must return XTT.06-001.
      for (let i = 1; i <= 67; i++) {
        await tx.insert(transportOrder).values({ ...tn, externalRef: 'XT.' + String(i).padStart(4, '0') });
      }
      const numbering = new OrderNumberingService();
      allocated = await numbering.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, FIXED_NOW);
    });
    const ref = requireDefined(allocated, 'allocate() result');
    expect(ref).toBe('XTT.06-001');
  });
  it('allocate() returns NNN strictly greater than the max of existing same-month XTT.06-NNN rows', async () => {
    let allocated: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      await seedExistingMonthlyRefs(tx, 6, 12);
      const numbering = new OrderNumberingService();
      allocated = await numbering.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, FIXED_NOW);
    });
    const ref = requireDefined(allocated, 'allocate() result');
    expect(parseMonthlyNumber(ref)).toBe(13);
  });
  it('allocated XTT.MM-NNN actually inserts: full create succeeds, no unique-constraint violation', async () => {
    let inserted = false;
    let verifyRef: string | undefined;
    let resolvedRef: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const tn = tenancyOf();
      await seedExistingMonthlyRefs(tx, 6, 5);
      const numbering = new OrderNumberingService();
      const ref = await numbering.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, FIXED_NOW);
      resolvedRef = ref;
      const [created] = await tx.insert(transportOrder).values({ ...tn, externalRef: ref }).returning();
      if (created !== undefined) {
        inserted = true;
        const [verify] = await tx.select({ externalRef: transportOrder.externalRef })
          .from(transportOrder)
          .where(and(eq(transportOrder.transportOrderId, created.transportOrderId), eq(transportOrder.companyId, OP.companyId)));
        const dbRef = verify?.externalRef;
        if (typeof dbRef === 'string') verifyRef = dbRef;
      }
    });
    expect(inserted).toBe(true);
    expect(verifyRef).toBe(resolvedRef);
    expect(resolvedRef).toMatch(MONTHLY_REGEX);
  });
});
