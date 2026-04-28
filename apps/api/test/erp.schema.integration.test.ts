// apps/api/test/erp.schema.integration.test.ts
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
  await d.execute(sql`CREATE TYPE erp_sync_direction AS ENUM ('outbound','inbound')`);
  await d.execute(sql`CREATE TYPE erp_sync_status AS ENUM ('pending','sent','acknowledged','failed')`);
  await d.execute(sql`
    CREATE TABLE erp_customer_map (
      erp_customer_map_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL, business_unit_id UUID NOT NULL, depot_id UUID NOT NULL, legal_entity_id UUID NOT NULL,
      internal_customer_id UUID NOT NULL,
      external_erp_id VARCHAR(128) NOT NULL,
      erp_system VARCHAR(64) NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT erp_customer_map_internal_uq UNIQUE (company_id, erp_system, internal_customer_id),
      CONSTRAINT erp_customer_map_external_uq UNIQUE (company_id, erp_system, external_erp_id)
    )
  `);
  await d.execute(sql`
    CREATE TABLE erp_invoice_map (
      erp_invoice_map_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL, business_unit_id UUID NOT NULL, depot_id UUID NOT NULL, legal_entity_id UUID NOT NULL,
      manifest_correlation_id UUID NOT NULL,
      transport_order_id UUID NOT NULL,
      external_erp_invoice_id VARCHAR(128),
      erp_system VARCHAR(64) NOT NULL,
      direction erp_sync_direction NOT NULL DEFAULT 'outbound',
      status erp_sync_status NOT NULL DEFAULT 'pending',
      sent_at TIMESTAMPTZ,
      acknowledged_at TIMESTAMPTZ,
      failure_reason VARCHAR(256),
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT erp_invoice_map_idempotency_uq UNIQUE (manifest_correlation_id, erp_system)
    )
  `);
}

describe('@fleet/api - ERP schema (integration)', () => {
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

  it('rejects duplicate (company, erpSystem, internalCustomerId) mapping', async () => {
    await db.execute(sql`
      INSERT INTO erp_customer_map (company_id, business_unit_id, depot_id, legal_entity_id, internal_customer_id, external_erp_id, erp_system)
      VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, 'ERP-1', 'sap')
    `);
    await expect(
      db.execute(sql`
        INSERT INTO erp_customer_map (company_id, business_unit_id, depot_id, legal_entity_id, internal_customer_id, external_erp_id, erp_system)
        VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, 'ERP-2', 'sap')
      `),
    ).rejects.toThrow();
  });

  it('rejects duplicate invoice (manifestCorrelationId, erpSystem)', async () => {
    const tx = `
      INSERT INTO erp_invoice_map (company_id, business_unit_id, depot_id, legal_entity_id, manifest_correlation_id, transport_order_id, erp_system)
      VALUES ('${TENANT.company_id}'::uuid, '${TENANT.business_unit_id}'::uuid, '${TENANT.depot_id}'::uuid, '${TENANT.legal_entity_id}'::uuid,
              '00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, 'sap')
    `;
    await db.execute(sql.raw(tx));
    await expect(db.execute(sql.raw(tx))).rejects.toThrow();
  });

  it('allows same internal customer in different ERP systems', async () => {
    const internalId = '00000000-0000-0000-0000-0000000000d1';
    await db.execute(sql`
      INSERT INTO erp_customer_map (company_id, business_unit_id, depot_id, legal_entity_id, internal_customer_id, external_erp_id, erp_system)
      VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${internalId}::uuid, 'ERP-A', 'sap')
    `);
    await expect(
      db.execute(sql`
        INSERT INTO erp_customer_map (company_id, business_unit_id, depot_id, legal_entity_id, internal_customer_id, external_erp_id, erp_system)
        VALUES (${TENANT.company_id}::uuid, ${TENANT.business_unit_id}::uuid, ${TENANT.depot_id}::uuid, ${TENANT.legal_entity_id}::uuid, ${internalId}::uuid, 'ERP-B', 'oracle')
      `),
    ).resolves.toBeDefined();
  });
});
