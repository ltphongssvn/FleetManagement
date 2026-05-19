// apps/api/test/transport-orders.trip-history.integration.test.ts
// PGLite integration: TransportOrdersService.tripHistory — completed road
// runs for the calling operator, grouped by Asia/Ho_Chi_Minh month via the
// shared @fleet/domain groupCompletedTripsByMonth helper. svc.create only
// produces planned runs, so completed runs are simulated by updating
// road_run.state + completed_at directly after creation.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { roadRun } from '../src/database/schema/transport.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
let svc: TransportOrdersService;
// Mark the operator's most-recently-created road run completed at a given ISO.
async function completeRoadRun(operatorId: string, completedAtIso: string): Promise<void> {
  const rows = await testDb.db
    .select({ id: roadRun.roadRunId })
    .from(roadRun)
    .where(eq(roadRun.assignedOperatorId, operatorId));
  const target = rows[rows.length - 1];
  if (!target) throw new Error('no road run to complete');
  await testDb.db
    .update(roadRun)
    .set({ state: 'completed', completedAt: new Date(completedAtIso) })
    .where(eq(roadRun.roadRunId, target.id));
}
describe('@fleet/api - TransportOrdersService.tripHistory (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    svc = new TransportOrdersService(testDb.db as never);
  }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  beforeEach(async () => {
    await testDb.db.execute(sql.raw(
      'TRUNCATE TABLE outbox, fleet_audit_log, sync_change_feed, ' +
      'road_run_transport_order, road_run, stop, transport_order, ' +
      'vehicle, customer, warehouse CASCADE',
    ));
  });
  it('returns no months when the operator has no completed runs', async () => {
    const op = createOperatorContext();
    await svc.create({
      externalRef: 'TO-PLANNED',
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: { assignedOperatorId: op.operatorId },
    }, op);
    const result = await svc.tripHistory(op);
    expect(result.months).toEqual([]);
  });
  it('groups completed runs by VN month, newest month first, with counts', async () => {
    const op = createOperatorContext();
    // Two completed in March 2026, one in February 2026.
    await svc.create({ externalRef: 'TO-M1', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: op.operatorId } }, op);
    await completeRoadRun(op.operatorId, '2026-03-02T03:00:00.000Z');
    await svc.create({ externalRef: 'TO-M2', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: op.operatorId } }, op);
    await completeRoadRun(op.operatorId, '2026-03-25T03:00:00.000Z');
    await svc.create({ externalRef: 'TO-F1', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: op.operatorId } }, op);
    await completeRoadRun(op.operatorId, '2026-02-10T03:00:00.000Z');
    const result = await svc.tripHistory(op);
    expect(result.months).toHaveLength(2);
    expect(result.months[0]?.monthKey).toBe('2026-03');
    expect(result.months[0]?.count).toBe(2);
    expect(result.months[1]?.monthKey).toBe('2026-02');
    expect(result.months[1]?.count).toBe(1);
  });
  it('each month carries trips with the listAssigned row shape (orderRef, completedAt)', async () => {
    const op = createOperatorContext();
    await svc.create({ externalRef: 'TO-SHAPE', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: op.operatorId } }, op);
    await completeRoadRun(op.operatorId, '2026-03-15T03:00:00.000Z');
    const result = await svc.tripHistory(op);
    const trip = result.months[0]?.trips[0];
    expect(trip?.orderRef).toBe('TO-SHAPE');
    expect(trip?.state).toBe('completed');
    expect(trip?.completedAt).toBe('2026-03-15T03:00:00.000Z');
  });
  it('excludes planned runs even when other runs are completed', async () => {
    const op = createOperatorContext();
    await svc.create({ externalRef: 'TO-DONE', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: op.operatorId } }, op);
    await completeRoadRun(op.operatorId, '2026-03-05T03:00:00.000Z');
    await svc.create({ externalRef: 'TO-STILL-PLANNED', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: op.operatorId } }, op);
    const result = await svc.tripHistory(op);
    const allRefs = result.months.flatMap((m) => m.trips.map((t) => t.orderRef));
    expect(allRefs).toEqual(['TO-DONE']);
  });
  it('isolates trip history by operator', async () => {
    const op1 = createOperatorContext();
    const op2 = createOperatorContext();
    await svc.create({ externalRef: 'TO-OP1', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: op1.operatorId } }, op1);
    await completeRoadRun(op1.operatorId, '2026-03-12T03:00:00.000Z');
    const result = await svc.tripHistory(op2);
    expect(result.months).toEqual([]);
  });
  it('buckets a late-night UTC completion into the VN next month', async () => {
    const op = createOperatorContext();
    await svc.create({ externalRef: 'TO-TZ', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: op.operatorId } }, op);
    // 2026-02-28T18:30Z -> 2026-03-01 01:30 Asia/Ho_Chi_Minh.
    await completeRoadRun(op.operatorId, '2026-02-28T18:30:00.000Z');
    const result = await svc.tripHistory(op);
    expect(result.months[0]?.monthKey).toBe('2026-03');
  });
});
