// apps/api/test/transport-orders.service.driver-alert-outbox.integration.test.ts
// S2 RED (T12 driver-order-alerts): creating an order must ALSO enqueue one
// driver_alert.requested outbox row (queue: alerts) in the SAME transaction,
// atomic with the order -- the crash-safe wake-up signal for the 4AM driver.
// Deliberately NOT via appendTriWrite: an alert intent is no aggregate delta;
// it must not pollute sync_change_feed (device sync) or fleet_audit_log.
// Contract round-trip: the stored payload minus the relay-stripped envelope
// keys {aggregateType, eventType, serverSeq} must STRICT-parse as
// DriverAlertJob -- the exact shape the alerts consumer parses at the queue
// trust boundary. Any drift (envelope leak, missing field) fails here first.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { DriverAlertJobSchema } from '@fleet/sync-protocol';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;
const OP = createOperatorContext();

async function seedActivePair(
  tx: TestTx,
  op: ReturnType<typeof createOperatorContext>,
): Promise<{
  operatorId: string;
  vehicleId: string;
}> {
  const operatorId = randomUUID();
  const tn = {
    companyId: op.companyId,
    businessUnitId: op.businessUnitId,
    depotId: op.depotId,
    legalEntityId: op.legalEntityId,
  };
  const [d] = await tx
    .insert(driver)
    .values({ ...tn, fullName: 'ALERT-INT', operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx
    .insert(vehicle)
    .values({ ...tn, plate: 'ALR-' + operatorId.slice(0, 4) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (!d || !v) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({
    ...tn,
    driverId: d.driverId,
    vehicleId: v.vehicleId,
  });
  return { operatorId, vehicleId: v.vehicleId };
}

describe('@fleet/api - TransportOrdersService driver-alert outbox emission (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });

  it('create() enqueues exactly one driver_alert.requested outbox row on the alerts queue, atomic with the order', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const { operatorId, vehicleId } = await seedActivePair(tx, OP);
      const result = await svc.create(
        {
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
        },
        OP,
      );
      const alertRows = await tx.execute<{ payload: string }>(
        sql.raw("SELECT payload::text as payload FROM outbox WHERE queue_name = 'alerts'"),
      );
      expect(alertRows.rows.length).toBe(1);
      const raw: unknown = JSON.parse(alertRows.rows[0]?.payload ?? 'null');
      expect(raw).not.toBeNull();
      const envelope = raw as Record<string, unknown>;
      expect(envelope['aggregateType']).toBe('driver_alert');
      expect(envelope['eventType']).toBe('driver_alert.requested');
      // Mirror the relay head-body split, then strict-parse the BODY with the
      // consumer schema (envelope keys stripped; serverSeq tolerated-if-absent).
      const { aggregateType: _at, eventType: _et, serverSeq: _ss, ...body } = envelope;
      const parsed = DriverAlertJobSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.alertKind).toBe('transport_order_created');
        expect(parsed.data.assignedOperatorId).toBe(operatorId);
        expect(parsed.data.roadRunId).toBe(result.roadRunId);
        expect(parsed.data.externalRef).toBe(result.externalRef);
      }
    });
  });

  it('does not add alert rows to sync_change_feed or fleet_audit_log (plain outbox insert, not tri-write)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const { operatorId, vehicleId } = await seedActivePair(tx, OP);
      await svc.create(
        {
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
        },
        OP,
      );
      const feed = await tx.execute<{ count: string }>(
        sql.raw(
          "SELECT COUNT(*)::text as count FROM sync_change_feed WHERE aggregate_type = 'driver_alert'",
        ),
      );
      const audit = await tx.execute<{ count: string }>(
        sql.raw(
          "SELECT COUNT(*)::text as count FROM fleet_audit_log WHERE aggregate_type = 'driver_alert'",
        ),
      );
      const projections = await tx.execute<{ count: string }>(
        sql.raw("SELECT COUNT(*)::text as count FROM outbox WHERE queue_name = 'projections'"),
      );
      expect(feed.rows[0]?.count).toBe('0');
      expect(audit.rows[0]?.count).toBe('0');
      expect(projections.rows[0]?.count).toBe('1');
    });
  });
});
