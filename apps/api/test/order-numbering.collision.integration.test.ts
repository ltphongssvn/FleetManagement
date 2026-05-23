// apps/api/test/order-numbering.collision.integration.test.ts
// RED then GREEN: OrderNumberingService must not collide with pre-existing
// transport_order.external_ref rows. Production state on 2026-05-22:
// order_sequence.next_value lags MAX(existing XT.NNNN). The naive allocator
// then formats the same number that already exists, the surrounding service
// insert fails the transport_order_company_external_ref_uq unique
// constraint, and the dispatcher sees HTTP 500.
//
// The GREEN production change must satisfy: allocate() returns a string
// whose numeric part is strictly greater than any existing
// transport_order.external_ref in the same company and prefix.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { OrderNumberingService } from '../src/transport-orders/order-numbering.service.js';
import { orderSequence } from '../src/database/schema/reference.js';
import { transportOrder } from '../src/database/schema/transport.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
const OP = createOperatorContext();
function tenancyOf(): { companyId: string; businessUnitId: string; depotId: string; legalEntityId: string } {
  return {
    companyId: OP.companyId, businessUnitId: OP.businessUnitId,
    depotId: OP.depotId, legalEntityId: OP.legalEntityId,
  };
}
function parseXtNumber(ref: string): number {
  const m = /^XT\.(\d+)$/.exec(ref);
  if (m?.[1] === undefined) throw new Error('not XT.NNNN: ' + ref);
  return parseInt(m[1], 10);
}
async function seedExistingRefs(tx: TestTx, count: number): Promise<void> {
  const tn = tenancyOf();
  for (let i = 1; i <= count; i++) {
    await tx.insert(transportOrder).values({ ...tn, externalRef: 'XT.' + String(i).padStart(4, '0') });
  }
}
function requireDefined<T>(v: T | undefined | null, label: string): T {
  if (v === undefined || v === null) throw new Error(label + ' was undefined/null');
  return v;
}
describe('@fleet/api - OrderNumberingService legacy-data collision (T3 hardening)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('production-repro: order_sequence.next_value lags MAX(external_ref); allocate() must skip past', async () => {
    let allocated: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const tn = tenancyOf();
      await seedExistingRefs(tx, 67);
      await tx.insert(orderSequence).values({ ...tn, prefix: 'XT', nextValue: 67, padWidth: 4 });
      const numbering = new OrderNumberingService();
      allocated = await numbering.allocate(tx as never, OP);
    });
    const ref = requireDefined(allocated, 'allocate() result');
    expect(parseXtNumber(ref)).toBeGreaterThan(67);
  });
  it('lazy-init: no sequence row but legacy XT.0100 exists - allocate() must skip past 100', async () => {
    let allocated: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const tn = tenancyOf();
      await seedExistingRefs(tx, 67);
      await tx.insert(transportOrder).values({ ...tn, externalRef: 'XT.0100' });
      const numbering = new OrderNumberingService();
      allocated = await numbering.allocate(tx as never, OP);
    });
    const ref = requireDefined(allocated, 'allocate() result');
    expect(parseXtNumber(ref)).toBeGreaterThan(100);
  });
  it('allocated number actually inserts: full create succeeds, no unique-constraint violation', async () => {
    let inserted = false;
    let verifyRef: string | undefined;
    let resolvedRef: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const tn = tenancyOf();
      await seedExistingRefs(tx, 67);
      await tx.insert(orderSequence).values({ ...tn, prefix: 'XT', nextValue: 67, padWidth: 4 });
      const numbering = new OrderNumberingService();
      const ref = await numbering.allocate(tx as never, OP);
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
  });
});
