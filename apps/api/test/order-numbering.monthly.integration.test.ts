// apps/api/test/order-numbering.monthly.integration.test.ts
// RED -> GREEN: T3 numbering format change (2026-Q2):
//   - new format: XTT.MM-NNN where MM is the 2-digit month of allocation
//     and NNN is a 3-digit per-month sequence that restarts at 001 on
//     every new month (per company).
//   - monthly rebase: the allocator queries MAX(numeric suffix) of
//     existing transport_order.external_ref rows matching the current
//     XTT.MM- prefix for the same company, then returns max+1. This
//     means crossing into a new month restarts the sequence at 001
//     automatically, with no schema migration needed on order_sequence.
//
// Tests are designed to be deterministic by accepting an injectable now
// clock on OrderNumberingService.allocate(). Without that injection, the
// test would depend on the wall clock and would flake at month boundaries.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { OrderNumberingService, DEFAULT_ORDER_PREFIX } from '../src/transport-orders/order-numbering.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { transportOrder, roadRun } from '../src/database/schema/transport.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
const OP = createOperatorContext();
const MONTHLY_REGEX = /^XTT\.(0[1-9]|1[0-2])-\d{3,}$/;
function tenancy(): {
  companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
} {
  return {
    companyId: OP.companyId, businessUnitId: OP.businessUnitId,
    depotId: OP.depotId, legalEntityId: OP.legalEntityId,
  };
}
async function seedOrderWithRef(tx: TestTx, externalRef: string): Promise<void> {
  // Minimal seed: every transport_order requires a road_run with non-null
  // operator + asset (the L5 invariant). We satisfy that with a paired
  // driver+vehicle so the FK + NOT NULL constraints are happy without
  // exercising the full service surface.
  const operatorId = randomUUID();
  const tn = tenancy();
  const [d] = await tx.insert(driver)
    .values({ ...tn, fullName: 'SEED-' + externalRef, operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle)
    .values({ ...tn, plate: 'SEED-' + externalRef })
    .returning({ vehicleId: vehicle.vehicleId });
  if (!d || !v) throw new Error('seed driver/vehicle failed');
  await tx.insert(roadRun).values({
    ...tn,
    assignedOperatorId: operatorId,
    assignedAssetId: v.vehicleId,
  });
  await tx.insert(transportOrder).values({
    ...tn,
    externalRef,
  });
}
describe('@fleet/api - OrderNumberingService monthly format XTT.MM-NNN', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 30_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('first allocation in June 2026 returns XTT.06-001', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const svc = new OrderNumberingService();
      const now = new Date('2026-06-15T10:00:00Z');
      const ref = await svc.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, now);
      return ref;
    });
    expect(captured).toBe('XTT.06-001');
  });
  it('matches the XTT.MM-NNN regex shape', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const svc = new OrderNumberingService();
      const now = new Date('2026-06-15T10:00:00Z');
      return svc.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, now);
    });
    expect(captured).toMatch(MONTHLY_REGEX);
  });
  it('second allocation in the same month produces NNN+1 (allocate -> persist -> allocate)', async () => {
    // The allocator computes NNN by MAX(numeric suffix of EXISTING rows),
    // so a realistic second-call test must persist the first ref before
    // calling allocate again. This mirrors how TransportOrdersService.create
    // uses the allocator: it returns a number, the surrounding create()
    // inserts the row inside the same transaction, the next caller sees
    // that row via the MAX rebase.
    const captured = await withTxIsolation(testDb, async (tx) => {
      const svc = new OrderNumberingService();
      const now = new Date('2026-06-15T10:00:00Z');
      const a = await svc.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, now);
      await seedOrderWithRef(tx, a);
      const b = await svc.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, now);
      return { a, b };
    });
    expect(captured?.a).toBe('XTT.06-001');
    expect(captured?.b).toBe('XTT.06-002');
  });
  it('crossing into a new month restarts the sequence at 001', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const svc = new OrderNumberingService();
      const june = new Date('2026-06-30T23:59:00Z');
      const july = new Date('2026-07-01T00:01:00Z');
      // Persist the June allocation so the July rebase MAX over current
      // month sees zero June rows for July\'s prefix and starts at 001.
      const j1 = await svc.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, june);
      await seedOrderWithRef(tx, j1);
      const j2 = await svc.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, june);
      await seedOrderWithRef(tx, j2);
      const ju1 = await svc.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, july);
      return { j1, j2, ju1 };
    });
    expect(captured?.j1).toBe('XTT.06-001');
    expect(captured?.j2).toBe('XTT.06-002');
    expect(captured?.ju1).toBe('XTT.07-001');
  });
  it('rebases against existing rows when persisted monthly refs exist', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const svc = new OrderNumberingService();
      const now = new Date('2026-06-15T10:00:00Z');
      // Pre-seed three monthly rows for June so MAX -> 003. Next allocation
      // must rebase to 004 even though order_sequence.next_value lags.
      await seedOrderWithRef(tx, 'XTT.06-001');
      await seedOrderWithRef(tx, 'XTT.06-002');
      await seedOrderWithRef(tx, 'XTT.06-003');
      return svc.allocate(tx as never, OP, DEFAULT_ORDER_PREFIX, now);
    });
    expect(captured).toBe('XTT.06-004');
  });
});
