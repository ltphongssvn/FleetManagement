// apps/api/test/transport-orders.service.numbering.integration.test.ts
// RED → GREEN: TransportOrdersService.create must allocate a server-assigned
// external_ref of the form XT.NNN via the OrderNumberingService dependency,
// regardless of any client-supplied externalRef. The number must be
// strictly monotonic per company (driven by order_sequence FOR UPDATE).
//
// Layer 4 invariants:
//   - response.externalRef is set and matches /^XT\.\d{4,}$/
//   - any client-supplied input.externalRef is ignored
//   - two sequential creates produce strictly increasing sequence numbers
//   - the assigned ref is also what gets persisted in transport_order.external_ref
//   - the assigned ref is what is carried in the outbox/audit/feed delta
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { OrderNumberingService } from '../src/transport-orders/order-numbering.service.js';
import { driver, vehicle, orderSequence } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { transportOrder } from '../src/database/schema/transport.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
const OP = createOperatorContext();
const ORDER_NUMBER_REGEX = /^XT\.\d{4,}$/;
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
describe('@fleet/api - TransportOrdersService auto-numbering (T3)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('returns externalRef matching XT.NNN on the response', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const numbering = new OrderNumberingService();
      const svc = new TransportOrdersService(tx as never, numbering);
      const pair = await seedActivePair(tx);
      const result = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: pair.operatorId, assignedAssetId: pair.vehicleId },
      }, OP);
      expect(result.externalRef).toMatch(ORDER_NUMBER_REGEX);
    });
  });
  it('ignores client-supplied externalRef and uses server-assigned XT.NNN', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const numbering = new OrderNumberingService();
      const svc = new TransportOrdersService(tx as never, numbering);
      const pair = await seedActivePair(tx);
      const clientGarbage = 'CLIENT-GARBAGE-XYZ';
      const result = await svc.create({
        externalRef: clientGarbage,
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: pair.operatorId, assignedAssetId: pair.vehicleId },
      }, OP);
      expect(result.externalRef).toMatch(ORDER_NUMBER_REGEX);
      expect(result.externalRef).not.toBe(clientGarbage);
      const [row] = await tx.select({ externalRef: transportOrder.externalRef })
        .from(transportOrder)
        .where(eq(transportOrder.transportOrderId, result.transportOrderId));
      expect(row?.externalRef).toBe(result.externalRef);
      expect(row?.externalRef).not.toBe(clientGarbage);
    });
  });
  it('produces strictly increasing XT.NNN across two sequential creates', async () => {
    await withTxIsolation(testDb, async (tx) => {
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
      const parse = (ref: string): number => {
        const m = ref.match(/^XT\.(\d+)$/);
        if (!m || !m[1]) throw new Error('not XT.NNN: ' + ref);
        return parseInt(m[1], 10);
      };
      const n1 = parse(r1.externalRef!);
      const n2 = parse(r2.externalRef!);
      expect(n2).toBe(n1 + 1);
    });
  });
  it('advances order_sequence.next_value after each allocation', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const numbering = new OrderNumberingService();
      const svc = new TransportOrdersService(tx as never, numbering);
      const pair = await seedActivePair(tx, OP, 'ADV');
      const before = await tx.select({ next: orderSequence.nextValue }).from(orderSequence)
        .where(and(eq(orderSequence.companyId, OP.companyId), eq(orderSequence.prefix, 'XT')));
      const beforeNext = before[0]?.next ?? 1;
      await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: pair.operatorId, assignedAssetId: pair.vehicleId },
      }, OP);
      const after = await tx.select({ next: orderSequence.nextValue }).from(orderSequence)
        .where(and(eq(orderSequence.companyId, OP.companyId), eq(orderSequence.prefix, 'XT')));
      expect(after[0]?.next).toBe(beforeNext + 1);
    });
  });
  it('carries the server-assigned externalRef into the audit/feed/outbox delta', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const numbering = new OrderNumberingService();
      const svc = new TransportOrdersService(tx as never, numbering);
      const pair = await seedActivePair(tx, OP, 'OBX');
      const result = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: pair.operatorId, assignedAssetId: pair.vehicleId },
      }, OP);
      expect(result.externalRef).toMatch(ORDER_NUMBER_REGEX);
      const ref = result.externalRef as string;
      const feedRows = await tx.execute<{ delta: unknown }>(sql.raw(
        'SELECT delta FROM sync_change_feed WHERE aggregate_type = ' + String.fromCharCode(39) + 'road_run' + String.fromCharCode(39),
      ));
      const found = feedRows.rows.some((r) => JSON.stringify(r.delta).includes(ref));
      expect(found).toBe(true);
    });
  });
});
