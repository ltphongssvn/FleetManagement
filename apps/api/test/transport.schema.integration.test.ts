// apps/api/test/transport.schema.integration.test.ts
// Integration tests for transport schema constraints with real Postgres.
// Schema applied via real drizzle migrations through migrate-test-db helper.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../src/database/schema/index.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;

const TENANT = {
  company_id: '00000000-0000-0000-0000-000000000003',
  business_unit_id: '00000000-0000-0000-0000-000000000004',
  depot_id: '00000000-0000-0000-0000-000000000005',
  legal_entity_id: '00000000-0000-0000-0000-000000000006',
};

async function seedTransportOrder(d: NodePgDatabase<typeof schema>): Promise<string> {
  const result = await d.execute<{ transport_order_id: string }>(sql`
    INSERT INTO transport_order (company_id, business_unit_id, depot_id, legal_entity_id)
    VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid)
    RETURNING transport_order_id
  `);
  const row = result.rows[0];
  if (!row) throw new Error('insert returned no row');
  return row.transport_order_id;
}

describe('@fleet/api - transport schema (integration)', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test');
  }, 90_000);

  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });

  beforeEach(async () => {
    await testDb.db.execute(sql`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '__drizzle_migrations')
        LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  });

  describe('transport_order', () => {
    it('rejects invalid state via pgEnum', async () => {
      await expect(
        testDb.db.execute(sql`
          INSERT INTO transport_order (company_id, business_unit_id, depot_id, legal_entity_id, state)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, 'shipped')
        `),
      ).rejects.toThrow();
    });

    it('accepts valid state', async () => {
      await expect(
        testDb.db.execute(sql`
          INSERT INTO transport_order (company_id, business_unit_id, depot_id, legal_entity_id, state)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, 'assigned')
        `),
      ).resolves.toBeDefined();
    });
  });

  describe('stop', () => {
    it('cascades delete from transport_order', async () => {
      const toId = await seedTransportOrder(testDb.db);
      await testDb.db.execute(sql`
        INSERT INTO stop (company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type)
        VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${toId}::uuid, 1, 'pickup')
      `);
      await testDb.db.execute(sql`DELETE FROM transport_order WHERE transport_order_id = ${toId}::uuid`);
      const remaining = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM stop`);
      expect(remaining.rows[0]?.count).toBe('0');
    });

    it('rejects sequence <= 0 via CHECK', async () => {
      const toId = await seedTransportOrder(testDb.db);
      await expect(
        testDb.db.execute(sql`
          INSERT INTO stop (company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${toId}::uuid, 0, 'pickup')
        `),
      ).rejects.toThrow();
    });

    it('rejects departed_at less than arrived_at via CHECK', async () => {
      const toId = await seedTransportOrder(testDb.db);
      await expect(
        testDb.db.execute(sql`
          INSERT INTO stop (company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type, arrived_at, departed_at)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${toId}::uuid, 1, 'pickup', '2026-04-27T12:00:00Z', '2026-04-27T11:00:00Z')
        `),
      ).rejects.toThrow();
    });

    it('rejects FK violation on unknown transport_order_id', async () => {
      await expect(
        testDb.db.execute(sql`
          INSERT INTO stop (company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, '00000000-0000-0000-0000-0000000000ff'::uuid, 1, 'pickup')
        `),
      ).rejects.toThrow();
    });
  });

  describe('road_run', () => {
    it('rejects completed_at less than started_at via CHECK', async () => {
      await expect(
        testDb.db.execute(sql`
          INSERT INTO road_run (company_id, business_unit_id, depot_id, legal_entity_id, started_at, completed_at)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, '2026-04-27T12:00:00Z', '2026-04-27T11:00:00Z')
        `),
      ).rejects.toThrow();
    });

    it('rejects invalid state via pgEnum', async () => {
      await expect(
        testDb.db.execute(sql`
          INSERT INTO road_run (company_id, business_unit_id, depot_id, legal_entity_id, state)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, 'returned')
        `),
      ).rejects.toThrow();
    });
  });

  describe('road_run_transport_order', () => {
    it('cascades from both road_run and transport_order', async () => {
      const toId = await seedTransportOrder(testDb.db);
      const rrResult = await testDb.db.execute<{ road_run_id: string }>(sql`
        INSERT INTO road_run (company_id, business_unit_id, depot_id, legal_entity_id)
        VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid)
        RETURNING road_run_id
      `);
      const rrRow = rrResult.rows[0];
      if (!rrRow) throw new Error('insert returned no row');
      const rrId = rrRow.road_run_id;
      await testDb.db.execute(sql`
        INSERT INTO road_run_transport_order (company_id, business_unit_id, depot_id, legal_entity_id, road_run_id, transport_order_id, sequence)
        VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${rrId}::uuid, ${toId}::uuid, 1)
      `);
      await testDb.db.execute(sql`DELETE FROM road_run WHERE road_run_id = ${rrId}::uuid`);
      const count = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM road_run_transport_order`);
      expect(count.rows[0]?.count).toBe('0');
    });
  });
});
