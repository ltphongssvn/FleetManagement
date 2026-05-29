// apps/api/test/transport-orders.service.numbering.integration.test.ts
// RED -> GREEN: TransportOrdersService.create must allocate a server-assigned
// external_ref of the form XTT.MM-NNN via the OrderNumberingService
// dependency, regardless of any client-supplied externalRef. The number
// must be strictly monotonic per company within a month (driven by
// order_sequence FOR UPDATE + monthly MAX rebase).
//
// Layer 4 invariants:
//   - response.externalRef is set and matches /^XTT\.(0[1-9]|1[0-2])-\d{3,}$/
//   - any client-supplied input.externalRef is ignored
//   - two sequential creates produce strictly increasing sequence numbers
//   - the assigned ref is also what gets persisted in transport_order.external_ref
//   - the assigned ref is what is carried in the outbox/audit/feed delta
//
// Isolation: tx-injection per test. withTxIsolation swallows in-body
// assertion failures via its rollback-signal .catch(), so EVERY expect()
// MUST run OUTSIDE the body on captured return values.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { OrderNumberingService, DEFAULT_ORDER_PREFIX } from '../src/transport-orders/order-numbering.service.js';
import { driver, vehicle, orderSequence } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { transportOrder } from '../src/database/schema/transport.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
const OP = createOperatorContext();
const MONTHLY_REGEX = /^XTT\.(0[1-9]|1[0-2])-\d{3,}$/;
function tenancyOf(op = OP): {
  companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
} {
  return {
    companyId: op.companyId, businessUnitId: op.businessUnitId,
    depotId: op.depotId, legalEntityId: op.legalEntityId,
  };
}
async function seedActivePair(tx: TestTx, op = OP, suffix = 'A'): Promise<{
  operatorId: string; vehicleId: string;
}> {
  const operatorId = randomUUID();
  const tn = tenancyOf(op);
  const [d] = await tx.insert(driver)
    .values({ ...tn, fullName: 'NUM-' + suffix, operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle)
    .values({ ...tn, plate: 'NUM-' + suffix + '-' + operatorId.slice(0, 4) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (!d || !v) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment)
    .values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId, vehicleId: v.vehicleId };
}
function parseMonthlyNumber(ref: string): number {
  const m = /^XTT\.\d{2}-(\d+)$/.exec(ref);
  if (!m?.[1]) throw new Error('not XTT.MM-NNN: ' + ref);
  return parseInt(m[1], 10);
}
describe('@fleet/api - TransportOrdersService auto-numbering (T3, XTT.MM-NNN)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('returns externalRef matching XTT.MM-NNN on the response', async () => {
    const externalRef = await withTxIsolation(testDb, async (tx) => {
      const numbering = new OrderNumberingService();
      const svc = new TransportOrdersService(tx as never, numbering);
      const pair = await seedActivePair(tx);
      const result = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: pair.operatorId, assignedAssetId: pair.vehicleId },
      }, OP);
      return result.externalRef;
    });
    expect(externalRef).toMatch(MONTHLY_REGEX);
  });
  it('ignores client-supplied externalRef and uses server-assigned XTT.MM-NNN', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const numbering = new OrderNumberingService();
      const svc = new TransportOrdersService(tx as never, numbering);
      const pair = await seedActivePair(tx);
      const clientGarbage = 'CLIENT-GARBAGE-XYZ';
      const result = await svc.create({
        externalRef: clientGarbage,
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: pair.operatorId, assignedAssetId: pair.vehicleId },
      }, OP);
      const [row] = await tx.select({ externalRef: transportOrder.externalRef })
        .from(transportOrder)
        .where(eq(transportOrder.transportOrderId, result.transportOrderId));
      return { resultRef: result.externalRef, dbRef: row?.externalRef, clientGarbage };
    });
    expect(captured?.resultRef).toMatch(MONTHLY_REGEX);
    expect(captured?.resultRef).not.toBe(captured?.clientGarbage);
    expect(captured?.dbRef).toBe(captured?.resultRef);
    expect(captured?.dbRef).not.toBe(captured?.clientGarbage);
  });
  it('produces strictly increasing XTT.MM-NNN across two sequential creates in the same month', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const numbering = new OrderNumberingService();
      const svc = new TransportOrdersService(tx as never, numbering);
      const a = await seedActivePair(tx, OP, 'SEQ1');
      const r1 = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: a.operatorId, assignedAssetId: a.vehicleId },
      }, OP);
      const b = await seedActivePair(tx, OP, 'SEQ2');
      const r2 = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: b.operatorId, assignedAssetId: b.vehicleId },
      }, OP);
      return { r1: r1.externalRef, r2: r2.externalRef };
    });
    expect(captured?.r1).toMatch(MONTHLY_REGEX);
    expect(captured?.r2).toMatch(MONTHLY_REGEX);
    if (captured === undefined) throw new Error('no captured');
    const n1 = parseMonthlyNumber(captured.r1);
    const n2 = parseMonthlyNumber(captured.r2);
    expect(n2).toBe(n1 + 1);
  });
  it('advances order_sequence.next_value after each allocation', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const numbering = new OrderNumberingService();
      const svc = new TransportOrdersService(tx as never, numbering);
      const pair = await seedActivePair(tx, OP, 'ADV');
      const before = await tx.select({ next: orderSequence.nextValue }).from(orderSequence)
        .where(and(eq(orderSequence.companyId, OP.companyId), eq(orderSequence.prefix, DEFAULT_ORDER_PREFIX)));
      const beforeNext = before[0]?.next ?? 1;
      await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: pair.operatorId, assignedAssetId: pair.vehicleId },
      }, OP);
      const after = await tx.select({ next: orderSequence.nextValue }).from(orderSequence)
        .where(and(eq(orderSequence.companyId, OP.companyId), eq(orderSequence.prefix, DEFAULT_ORDER_PREFIX)));
      return { beforeNext, afterNext: after[0]?.next };
    });
    if (captured?.afterNext === undefined) throw new Error('no order_sequence row');
    expect(captured.afterNext).toBeGreaterThan(captured.beforeNext);
  });
  it('carries the server-assigned externalRef into the audit/feed/outbox delta', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const numbering = new OrderNumberingService();
      const svc = new TransportOrdersService(tx as never, numbering);
      const pair = await seedActivePair(tx, OP, 'OBX');
      const result = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: pair.operatorId, assignedAssetId: pair.vehicleId },
      }, OP);
      const feedRows = await tx.execute<{ delta: unknown }>(sql.raw(
        'SELECT delta FROM sync_change_feed WHERE aggregate_type = ' + String.fromCharCode(39) + 'road_run' + String.fromCharCode(39),
      ));
      const ref = result.externalRef;
      const found = feedRows.rows.some((r) => JSON.stringify(r.delta).includes(ref));
      return { ref, found };
    });
    expect(captured?.ref).toMatch(MONTHLY_REGEX);
    expect(captured?.found).toBe(true);
  });
});
