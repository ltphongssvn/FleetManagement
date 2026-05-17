// apps/api/test/transport-orders.service.concurrency.test.ts
// RED test: proves SELECT MAX(server_seq)+1 in TransportOrdersService.create()
// races under concurrent road_run creation, producing duplicate server_seq values.
// GREEN after migrating to allocateServerSeq('fleet_server_seq').
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: MigratedTestDb;
let svc: TransportOrdersService;
const OP = createOperatorContext();
const PARALLELISM = 5;

describe('@fleet/api - TransportOrdersService concurrent create (RED)', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test_to_seq');
    svc = new TransportOrdersService(testDb.db as never);
  }, 90_000);

  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });

  beforeEach(async () => {
    await truncateAllTables(testDb.db);
  });

  it('allocates distinct server_seq for N concurrent create() calls with road_run', async () => {
    await Promise.all(
      Array.from({ length: PARALLELISM }, (_, i) =>
        svc.create({
          externalRef: `TO-${String(i)}`,
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: { plannedStartAt: '2026-04-30T08:00:00.000Z' },
        }, OP),
      ),
    );

    const result = await testDb.db.execute<{ total: string; distinct: string }>(sql`
      SELECT COUNT(*)::text AS total, COUNT(DISTINCT server_seq)::text AS distinct
      FROM sync_change_feed WHERE aggregate_type = 'road_run'
    `);
    expect(result.rows[0]?.total).toBe(String(PARALLELISM));
    expect(result.rows[0]?.distinct).toBe(String(PARALLELISM));
  }, 60_000);
});
