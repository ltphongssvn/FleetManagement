// apps/api/test/transport.schema.integration.test.ts
// Integration tests for transport schema constraints with real Postgres.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../src/database/schema/index.js';

const POSTGRES_IMAGE = 'postgres:16.4-alpine3.20';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: NodePgDatabase<typeof schema>;

const TENANT = {
  company_id: '00000000-0000-0000-0000-000000000003',
  business_unit_id: '00000000-0000-0000-0000-000000000004',
  depot_id: '00000000-0000-0000-0000-000000000005',
  legal_entity_id: '00000000-0000-0000-0000-000000000006',
};

async function applySchema(d: NodePgDatabase<typeof schema>): Promise<void> {
  await d.execute(sql`CREATE TYPE transport_order_state AS ENUM ('draft','assigned','in_transit','completed','cancelled')`);
  await d.execute(sql`CREATE TYPE road_run_state AS ENUM ('planned','dispatched','started','completed','cancelled')`);
  await d.execute(sql`
    CREATE TABLE transport_order (
      transport_order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL,
      business_unit_id UUID NOT NULL,
      depot_id UUID NOT NULL,
      legal_entity_id UUID NOT NULL,
      external_ref VARCHAR(64),
      state transport_order_state NOT NULL DEFAULT 'draft',
      customer_id UUID,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT transport_order_updated_after_created CHECK (updated_at >= created_at)
    )
  `);
  await d.execute(sql`
    CREATE TABLE stop (
      stop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL,
      business_unit_id UUID NOT NULL,
      depot_id UUID NOT NULL,
      legal_entity_id UUID NOT NULL,
      transport_order_id UUID NOT NULL REFERENCES transport_order(transport_order_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      stop_type VARCHAR(32) NOT NULL,
      yard_id UUID,
      address JSONB,
      planned_at TIMESTAMPTZ,
      arrived_at TIMESTAMPTZ,
      departed_at TIMESTAMPTZ,
      CONSTRAINT stop_sequence_positive CHECK (sequence > 0),
      CONSTRAINT stop_departed_after_arrived CHECK (departed_at IS NULL OR arrived_at IS NULL OR departed_at >= arrived_at)
    )
  `);
  await d.execute(sql`
    CREATE TABLE road_run (
      road_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL,
      business_unit_id UUID NOT NULL,
      depot_id UUID NOT NULL,
      legal_entity_id UUID NOT NULL,
      state road_run_state NOT NULL DEFAULT 'planned',
      assigned_operator_id UUID,
      assigned_asset_id UUID,
      planned_start_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT road_run_completed_after_started CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
    )
  `);
  await d.execute(sql`
    CREATE TABLE road_run_transport_order (
      road_run_transport_order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL,
      business_unit_id UUID NOT NULL,
      depot_id UUID NOT NULL,
      legal_entity_id UUID NOT NULL,
      road_run_id UUID NOT NULL REFERENCES road_run(road_run_id) ON DELETE CASCADE,
      transport_order_id UUID NOT NULL REFERENCES transport_order(transport_order_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      CONSTRAINT rrto_sequence_positive CHECK (sequence > 0)
    )
  `);
}

async function seedTransportOrder(d: NodePgDatabase<typeof schema>): Promise<string> {
  const result = await d.execute<{ transport_order_id: string }>(sql`
    INSERT INTO transport_order (company_id, business_unit_id, depot_id, legal_entity_id)
    VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid)
    RETURNING transport_order_id
  `);
  const row = result.rows[0]; if (!row) throw new Error('insert returned no row'); return row.transport_order_id;
}

describe('@fleet/api - transport schema (integration)', () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('fleet_test').withReuse().start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema, casing: 'snake_case' });
    await applySchema(db);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(sql`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema())
        LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  });

  describe('transport_order', () => {
    it('rejects invalid state via pgEnum', async () => {
      await expect(
        db.execute(sql`
          INSERT INTO transport_order (company_id, business_unit_id, depot_id, legal_entity_id, state)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, 'shipped')
        `),
      ).rejects.toThrow();
    });

    it('accepts valid state', async () => {
      await expect(
        db.execute(sql`
          INSERT INTO transport_order (company_id, business_unit_id, depot_id, legal_entity_id, state)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, 'assigned')
        `),
      ).resolves.toBeDefined();
    });
  });

  describe('stop', () => {
    it('cascades delete from transport_order', async () => {
      const toId = await seedTransportOrder(db);
      await db.execute(sql`
        INSERT INTO stop (company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type)
        VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${toId}::uuid, 1, 'pickup')
      `);
      await db.execute(sql`DELETE FROM transport_order WHERE transport_order_id = ${toId}::uuid`);
      const remaining = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM stop`);
      expect(remaining.rows[0]?.count).toBe('0');
    });

    it('rejects sequence <= 0 via CHECK', async () => {
      const toId = await seedTransportOrder(db);
      await expect(
        db.execute(sql`
          INSERT INTO stop (company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${toId}::uuid, 0, 'pickup')
        `),
      ).rejects.toThrow();
    });

    it('rejects departed_at < arrived_at via CHECK', async () => {
      const toId = await seedTransportOrder(db);
      await expect(
        db.execute(sql`
          INSERT INTO stop (company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type, arrived_at, departed_at)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${toId}::uuid, 1, 'pickup', '2026-04-27T12:00:00Z', '2026-04-27T11:00:00Z')
        `),
      ).rejects.toThrow();
    });

    it('rejects FK violation on unknown transport_order_id', async () => {
      await expect(
        db.execute(sql`
          INSERT INTO stop (company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, '00000000-0000-0000-0000-0000000000ff'::uuid, 1, 'pickup')
        `),
      ).rejects.toThrow();
    });
  });

  describe('road_run', () => {
    it('rejects completed_at < started_at via CHECK', async () => {
      await expect(
        db.execute(sql`
          INSERT INTO road_run (company_id, business_unit_id, depot_id, legal_entity_id, started_at, completed_at)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, '2026-04-27T12:00:00Z', '2026-04-27T11:00:00Z')
        `),
      ).rejects.toThrow();
    });

    it('rejects invalid state via pgEnum', async () => {
      await expect(
        db.execute(sql`
          INSERT INTO road_run (company_id, business_unit_id, depot_id, legal_entity_id, state)
          VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, 'returned')
        `),
      ).rejects.toThrow();
    });
  });

  describe('road_run_transport_order', () => {
    it('cascades from both road_run and transport_order', async () => {
      const toId = await seedTransportOrder(db);
      const rrResult = await db.execute<{ road_run_id: string }>(sql`
        INSERT INTO road_run (company_id, business_unit_id, depot_id, legal_entity_id)
        VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid)
        RETURNING road_run_id
      `);
      const rrRow = rrResult.rows[0]; if (!rrRow) throw new Error('insert returned no row'); const rrId = rrRow.road_run_id;
      await db.execute(sql`
        INSERT INTO road_run_transport_order (company_id, business_unit_id, depot_id, legal_entity_id, road_run_id, transport_order_id, sequence)
        VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${rrId}::uuid, ${toId}::uuid, 1)
      `);
      await db.execute(sql`DELETE FROM road_run WHERE road_run_id = ${rrId}::uuid`);
      const count = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM road_run_transport_order`);
      expect(count.rows[0]?.count).toBe('0');
    });
  });
});
