// apps/api/test/transport-orders.service.list-assigned.integration.test.ts
// PGLite integration: exercises the real listAssigned() body — assigned-row
// query, empty-result branch, stop grouping, row enrichment (plate, orderRef,
// customer + pickup/delivery warehouse names), and tenancy isolation.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { vehicle, customer, warehouse } from '../src/database/schema/reference.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;
let svc: TransportOrdersService;

describe('@fleet/api - TransportOrdersService.listAssigned (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    svc = new TransportOrdersService(testDb.db as never);
  }, 60_000); // CI fork+PGLite-WASM cold start can exceed 30s under load

  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });

  beforeEach(async () => {
    await testDb.db.execute(sql.raw(
      'TRUNCATE TABLE outbox, fleet_audit_log, sync_change_feed, ' +
      'road_run_transport_order, road_run, stop, transport_order, ' +
      'vehicle, customer, warehouse CASCADE',
    ));
  });

  it('returns empty rows when operator has no assigned road runs', async () => {
    const op = createOperatorContext();
    const result = await svc.listAssigned(op);
    expect(result.rows).toEqual([]);
  });

  it('returns assigned road run with its stops grouped under the order', async () => {
    const op = createOperatorContext();
    await svc.create({
      externalRef: 'TO-LA-1',
      stops: [
        { sequence: 1, stopType: 'pickup', plannedAt: '2026-05-01T08:00:00.000Z' },
        { sequence: 2, stopType: 'dropoff' },
      ],
      roadRun: {
        plannedStartAt: '2026-05-01T07:00:00.000Z',
        assignedOperatorId: op.operatorId,
      },
    }, op);

    const result = await svc.listAssigned(op);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row?.externalRef).toBe('TO-LA-1');
    expect(row?.state).toBe('planned');
    expect(row?.plannedStartAt).toBe('2026-05-01T07:00:00.000Z');
    // A planned road run has not started/completed: these must be present
    // as null (not undefined) so the driver-app AssignmentRow schema, which
    // requires string|null, can parse the response.
    expect(row?.startedAt).toBeNull();
    expect(row?.completedAt).toBeNull();
    expect(row?.stops).toHaveLength(2);
    expect(row?.stops[0]).toEqual({
      sequence: 1,
      stopType: 'pickup',
      plannedAt: '2026-05-01T08:00:00.000Z',
    });
    expect(row?.stops[1]).toEqual({
      sequence: 2,
      stopType: 'dropoff',
      plannedAt: null,
    });
  });

  it('enriches rows with plate, orderRef, customerName, pickup/delivery names', async () => {
    const op = createOperatorContext();
    const vehicleId = '00000000-0000-0000-0000-0000000000a1';
    const customerId = '00000000-0000-0000-0000-0000000000b2';
    const pickupWhId = '00000000-0000-0000-0000-0000000000c3';
    const deliveryWhId = '00000000-0000-0000-0000-0000000000d4';
    const tn = {
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
    };
    await testDb.db.insert(vehicle).values({ ...tn, vehicleId, plate: '62H-99999' });
    await testDb.db.insert(customer).values({ ...tn, customerId, name: 'ACME Logistics' });
    await testDb.db.insert(warehouse).values([
      { ...tn, warehouseId: pickupWhId, name: 'North Pickup Dock', role: 'pickup' },
      { ...tn, warehouseId: deliveryWhId, name: 'South Delivery Bay', role: 'delivery' },
    ]);
    await svc.create({
      externalRef: 'TO-ENRICH-1',
      customerId,
      stops: [
        { sequence: 1, stopType: 'pickup', yardId: pickupWhId },
        { sequence: 2, stopType: 'delivery', yardId: deliveryWhId },
      ],
      roadRun: { assignedOperatorId: op.operatorId, assignedAssetId: vehicleId },
    }, op);

    const result = await svc.listAssigned(op);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row?.orderRef).toBe('TO-ENRICH-1');
    expect(row?.plate).toBe('62H-99999');
    expect(row?.customerName).toBe('ACME Logistics');
    expect(row?.pickupName).toBe('North Pickup Dock');
    expect(row?.deliveryName).toBe('South Delivery Bay');
  });

  it('enrichment fields are null when no vehicle/customer/warehouse is linked', async () => {
    const op = createOperatorContext();
    await svc.create({
      externalRef: 'TO-BARE-1',
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: { assignedOperatorId: op.operatorId },
    }, op);

    const result = await svc.listAssigned(op);
    const row = result.rows[0];
    expect(row?.orderRef).toBe('TO-BARE-1');
    expect(row?.plate).toBeNull();
    expect(row?.customerName).toBeNull();
    expect(row?.pickupName).toBeNull();
    expect(row?.deliveryName).toBeNull();
  });

  it('excludes road runs assigned to a different operator', async () => {
    const op1 = createOperatorContext();
    const op2 = createOperatorContext();
    await svc.create({
      externalRef: 'TO-LA-2',
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: { assignedOperatorId: op1.operatorId },
    }, op1);

    const result = await svc.listAssigned(op2);
    expect(result.rows).toEqual([]);
  });
});
