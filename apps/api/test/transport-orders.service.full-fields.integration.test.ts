// apps/api/test/transport-orders.service.full-fields.integration.test.ts
// PGLite integration: exercises the truthy side of every optional-field
// ternary in create() — externalRef, customerId, metadata all set; a stop
// with yardId + plannedAt set; roadRun with plannedStartAt + assignedAssetId
// + assignedOperatorId all set. Then listAssigned with a populated order
// that also has a stop WITHOUT plannedAt, pinning the null-side of line 145
// and the order-match if at line 133. Closes branch coverage on
// transport-orders.service.ts.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;
let svc: TransportOrdersService;

describe('@fleet/api - TransportOrdersService (all optional fields populated)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    svc = new TransportOrdersService(testDb.db as never);
  }, 30_000);

  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });

  beforeEach(async () => {
    await testDb.db.execute(sql.raw(
      'TRUNCATE TABLE outbox, fleet_audit_log, sync_change_feed, ' +
      'road_run_transport_order, road_run, stop, transport_order CASCADE',
    ));
  });

  it('create populates every optional field, listAssigned returns it with mixed stops', async () => {
    const op = createOperatorContext();
    const customerId = randomUUID();
    const yardId = randomUUID();
    const assetId = randomUUID();

    const result = await svc.create({
      externalRef: 'TO-FULL-1',
      customerId,
      metadata: { priority: 'high', note: 'full-fields path' },
      stops: [
        {
          sequence: 1,
          stopType: 'pickup',
          yardId,
          plannedAt: '2026-06-01T09:00:00.000Z',
        },
        { sequence: 2, stopType: 'dropoff' },
      ],
      roadRun: {
        plannedStartAt: '2026-06-01T08:00:00.000Z',
        assignedOperatorId: op.operatorId,
        assignedAssetId: assetId,
      },
    }, op);

    expect(result.transportOrderId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.roadRunId).toMatch(/^[0-9a-f-]{36}$/i);

    const list = await svc.listAssigned(op);
    expect(list.rows).toHaveLength(1);
    const row = list.rows[0];
    expect(row?.externalRef).toBe('TO-FULL-1');
    expect(row?.plannedStartAt).toBe('2026-06-01T08:00:00.000Z');
    expect(row?.stops).toHaveLength(2);
    expect(row?.stops[0]?.plannedAt).toBe('2026-06-01T09:00:00.000Z');
    expect(row?.stops[1]?.plannedAt).toBeNull();
  });
});
