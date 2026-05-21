// apps/api/test/transport-orders.service.concurrency.test.ts
// RED test: proves SELECT MAX(server_seq)+1 in TransportOrdersService.create()
// races under concurrent road_run creation, producing duplicate server_seq values.
// GREEN after migrating to allocateServerSeq('fleet_server_seq').
//
// 2026 invariant: every order requires a roadRun + active driver-vehicle
// pair. This test seeds N distinct pairs (one per parallel call) so each
// concurrent create() has a valid backing assignment to reference.
//
// Isolation: TRUNCATE per test (Tier 3 — concurrency tests need multiple
// real connections; cannot use tx-injection because all parallel calls
// would serialize on a single transaction).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
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
    const tn = {
      companyId: OP.companyId, businessUnitId: OP.businessUnitId,
      depotId: OP.depotId, legalEntityId: OP.legalEntityId,
    };
    // Seed N distinct driver-vehicle pairs (one per parallel order).
    const pairs: { operatorId: string; vehicleId: string }[] = [];
    for (let i = 0; i < PARALLELISM; i++) {
      const operatorId = randomUUID();
      const [d] = await testDb.db.insert(driver).values({
        ...tn, fullName: 'CC-' + String(i), operatorId,
      }).returning({ driverId: driver.driverId });
      const [v] = await testDb.db.insert(vehicle).values({
        ...tn, plate: 'CC-' + String(i),
      }).returning({ vehicleId: vehicle.vehicleId });
      if (!d || !v) throw new Error('seed failed');
      await testDb.db.insert(driverVehicleAssignment).values({
        ...tn, driverId: d.driverId, vehicleId: v.vehicleId,
      });
      pairs.push({ operatorId, vehicleId: v.vehicleId });
    }
    await Promise.all(
      pairs.map((p, i) =>
        svc.create({
          externalRef: 'TO-' + String(i),
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: {
            plannedStartAt: '2026-04-30T08:00:00.000Z',
            assignedOperatorId: p.operatorId,
            assignedAssetId: p.vehicleId,
          },
        }, OP),
      ),
    );
    const result = await testDb.db.execute<{ total: string; distinct: string }>(sql.raw(
      'SELECT COUNT(*)::text AS total, COUNT(DISTINCT server_seq)::text AS distinct '
      + 'FROM sync_change_feed WHERE aggregate_type = ' + String.fromCharCode(39) + 'road_run' + String.fromCharCode(39),
    ));
    expect(result.rows[0]?.total).toBe(String(PARALLELISM));
    expect(result.rows[0]?.distinct).toBe(String(PARALLELISM));
  }, 60_000);
});
