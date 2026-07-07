// apps/api/test/transport-orders.service.driver-pagination.integration.test.ts
// PGlite integration (RED-first) for the driver 'Xem Lệnh Điều Xe' pagination
// feature on TransportOrdersService:
//
//  (a) listAssigned() must return ONLY active (non-terminal) road runs — the
//      screenshot bug is that completed runs ride along forever. Seed a planned
//      + a completed run for the same operator; assigned must show only planned.
//  (b) listCompleted(op, { page, pageSize, search }) is NEW: completed-only,
//      offset paginated, newest-first, with optional ILIKE search over customer
//      name, returning the SSOT DriverCompletedPageResponseSchema envelope
//      (data + page/pageSize/total/totalPages/hasMore).
//  (c) tripHistory() must STILL return completed runs after listAssigned is
//      filtered — internal-caller regression guard.
//  (d) findById() must STILL resolve a COMPLETED order after listAssigned is
//      active-filtered — findById reuses the driver-rows query to locate an
//      order by id across ALL states; the refactor must not hide completed
//      orders from review. Passes today; must stay green through GREEN.
//
// svc.create only produces PLANNED runs, so completed runs are simulated by
// updating road_run.state + completed_at AFTER creation, via the Drizzle query
// builder (NOT raw multi-statement SQL): under withTxIsolation the tx is torn
// down by a throwing rollback, and raw multi-statement executes on PGLite's
// WASM pg client can leave the socket in a state that crashes the worker. The
// builder path matches the sibling specs and is crash-free. Every completedAt
// is a real ISO string (never a sentinel: new Date('X') would be Invalid Date
// and crash the pg timestamp mapper). Isolation: tx-injection per test.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { driver, vehicle, customer } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { roadRun } from '../src/database/schema/transport.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import { DriverCompletedPageResponseSchema } from '@fleet/sync-protocol';

let testDb: PgliteTestDb;

async function seedActivePair(tx: TestTx, op: ReturnType<typeof createOperatorContext>): Promise<{
  operatorId: string; vehicleId: string;
}> {
  const operatorId = op.operatorId;
  const tn = {
    companyId: op.companyId, businessUnitId: op.businessUnitId,
    depotId: op.depotId, legalEntityId: op.legalEntityId,
  };
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'DP', operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'DP-' + randomUUID().slice(0, 4) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId, vehicleId: v.vehicleId };
}

// road runs for an operator, ordered oldest planned_start_at first.
async function orderedRunIds(tx: TestTx, operatorId: string): Promise<readonly string[]> {
  const rows = await tx
    .select({ id: roadRun.roadRunId, planned: roadRun.plannedStartAt })
    .from(roadRun)
    .where(eq(roadRun.assignedOperatorId, operatorId));
  return [...rows]
    .sort((a, b) => {
      const av = a.planned ? a.planned.getTime() : 0;
      const bv = b.planned ? b.planned.getTime() : 0;
      return av - bv;
    })
    .map((r) => r.id);
}

// Complete ALL road runs for an operator at one timestamp (Drizzle builder).
async function completeAll(tx: TestTx, operatorId: string, completedAtIso: string): Promise<void> {
  await tx.update(roadRun)
    .set({ state: 'completed', completedAt: new Date(completedAtIso) })
    .where(eq(roadRun.assignedOperatorId, operatorId));
}

// Complete each run in creation order with a DISTINCT real ISO completedAt so
// newest-first ordering is deterministic. isoList[i] applies to the i-th oldest.
async function completeEachDistinct(tx: TestTx, operatorId: string, isoList: readonly string[]): Promise<void> {
  const ids = await orderedRunIds(tx, operatorId);
  for (let i = 0; i < ids.length; i += 1) {
    const iso = isoList[i];
    const id = ids[i];
    if (iso === undefined || id === undefined) continue;
    await tx.update(roadRun)
      .set({ state: 'completed', completedAt: new Date(iso) })
      .where(eq(roadRun.roadRunId, id));
  }
}

// Complete ONLY the newest run (latest planned_start_at), leaving older runs
// planned. Real ISO -> Date; no sentinel strings.
async function completeNewest(tx: TestTx, operatorId: string, completedAtIso: string): Promise<void> {
  const ids = await orderedRunIds(tx, operatorId);
  const newestId = ids[ids.length - 1];
  if (newestId === undefined) return;
  await tx.update(roadRun)
    .set({ state: 'completed', completedAt: new Date(completedAtIso) })
    .where(eq(roadRun.roadRunId, newestId));
}

describe('@fleet/api - TransportOrdersService driver pagination (RED)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });

  it('(a) listAssigned returns only active runs — completed runs are excluded', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      await svc.create({
        externalRef: 'TO-ACTIVE',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-06-01T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      await svc.create({
        externalRef: 'TO-DONE',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-06-02T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      // complete only the newer run (day 02), leaving day 01 planned
      await completeNewest(tx, operatorId, '2026-06-12T09:00:00.000Z');
      const active = await svc.listAssigned(op);
      const states = active.rows.map((r) => r.state);
      expect(states.every((s) => s !== 'completed' && s !== 'cancelled')).toBe(true);
      expect(active.rows).toHaveLength(1);
      expect(active.rows[0]?.state).toBe('planned');
    });
  });

  it('(b) listCompleted returns the SSOT envelope with completed-only rows, newest first', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      for (let i = 1; i <= 3; i += 1) {
        await svc.create({
          externalRef: 'TO-C' + String(i),
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: { plannedStartAt: '2026-06-0' + String(i) + 'T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
        }, op);
      }
      await completeEachDistinct(tx, operatorId, [
        '2026-06-10T09:00:00.000Z',
        '2026-06-11T09:00:00.000Z',
        '2026-06-12T09:00:00.000Z',
      ]);
      const page = await svc.listCompleted(op, { page: 1, pageSize: 20 });
      const parsed = DriverCompletedPageResponseSchema.parse(page);
      expect(parsed.total).toBe(3);
      expect(parsed.data).toHaveLength(3);
      expect(parsed.data.every((r) => r.state === 'completed')).toBe(true);
      expect(parsed.data[0]?.completedAt).toBe('2026-06-12T09:00:00.000Z');
      expect(parsed.hasMore).toBe(false);
    });
  });

  it('(b) listCompleted paginates: pageSize 2 over 3 completed -> page1 has 2, hasMore true; page2 has 1', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      for (let i = 1; i <= 3; i += 1) {
        await svc.create({
          externalRef: 'TO-P' + String(i),
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: { plannedStartAt: '2026-06-0' + String(i) + 'T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
        }, op);
      }
      await completeAll(tx, operatorId, '2026-06-12T09:00:00.000Z');
      const p1 = await svc.listCompleted(op, { page: 1, pageSize: 2 });
      expect(p1.data).toHaveLength(2);
      expect(p1.total).toBe(3);
      expect(p1.totalPages).toBe(2);
      expect(p1.hasMore).toBe(true);
      const p2 = await svc.listCompleted(op, { page: 2, pageSize: 2 });
      expect(p2.data).toHaveLength(1);
      expect(p2.hasMore).toBe(false);
    });
  });

  it('(b) listCompleted search filters by customer name (ILIKE, case-insensitive)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
      const daiThanhId = '00000000-0000-0000-0000-0000000000e1';
      const otherId = '00000000-0000-0000-0000-0000000000e2';
      await tx.insert(customer).values([
        { ...tn, customerId: daiThanhId, name: 'ĐẠI THÀNH' },
        { ...tn, customerId: otherId, name: 'HIỀN NGUYỄN' },
      ]);
      await svc.create({
        externalRef: 'TO-S1', customerId: daiThanhId,
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      await svc.create({
        externalRef: 'TO-S2', customerId: otherId,
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      await completeAll(tx, operatorId, '2026-06-12T09:00:00.000Z');
      const hit = await svc.listCompleted(op, { page: 1, pageSize: 20, search: 'đại thành' });
      expect(hit.total).toBe(1);
      expect(hit.data[0]?.customerName).toBe('ĐẠI THÀNH');
    });
  });

  it('(c) tripHistory still returns completed runs after listAssigned is active-filtered (internal-caller guard)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      await svc.create({
        externalRef: 'TO-TH',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      await completeAll(tx, operatorId, '2026-06-12T09:00:00.000Z');
      const history = await svc.tripHistory(op);
      const totalTrips = history.months.reduce((n, m) => n + m.trips.length, 0);
      expect(totalTrips).toBe(1);
      expect(history.months[0]?.trips[0]?.state).toBe('completed');
    });
  });

  it('(d) findById still resolves a COMPLETED order after active-filtering (review guard)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await svc.create({
        externalRef: 'TO-FIND',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      await completeAll(tx, operatorId, '2026-06-12T09:00:00.000Z');
      const found = await svc.findById(created.transportOrderId, op);
      expect(found.transportOrderId).toBe(created.transportOrderId);
      expect(found.state).toBe('completed');
    });
  });
});
