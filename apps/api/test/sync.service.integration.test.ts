// apps/api/test/sync.service.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../src/database/schema/index.js';
import { SyncService, type OperatorContext } from '../src/sync/sync.service.js';
import type { SyncActionInput } from '../src/sync/sync.dto.js';

const POSTGRES_IMAGE = 'postgres:16.4-alpine3.20';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let service: SyncService;

const OP: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-000000000002',
  companyId: '00000000-0000-0000-0000-000000000003',
  businessUnitId: '00000000-0000-0000-0000-000000000004',
  depotId: '00000000-0000-0000-0000-000000000005',
  legalEntityId: '00000000-0000-0000-0000-000000000006',
};

function makeAction(id: string): SyncActionInput {
  return {
    actionId: id,
    aggregateType: 'transport_order',
    aggregateId: '00000000-0000-0000-0000-000000000010',
    payload: { state: 'assigned' },
    timestamp: '2026-04-27T18:00:00.000Z',
  };
}

async function applySchema(d: NodePgDatabase<typeof schema>): Promise<void> {
  await d.execute(sql`
    CREATE TABLE fleet_audit_log (
      audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL, business_unit_id UUID NOT NULL, depot_id UUID NOT NULL, legal_entity_id UUID NOT NULL,
      server_seq BIGINT NOT NULL,
      operator_id UUID,
      event_type VARCHAR(64) NOT NULL,
      aggregate_type VARCHAR(64) NOT NULL,
      aggregate_id UUID NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await d.execute(sql`
    CREATE TABLE sync_change_feed (
      feed_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL, business_unit_id UUID NOT NULL, depot_id UUID NOT NULL, legal_entity_id UUID NOT NULL,
      server_seq BIGINT NOT NULL,
      action_id UUID NOT NULL UNIQUE,
      aggregate_type VARCHAR(64) NOT NULL,
      aggregate_id UUID NOT NULL,
      delta JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await d.execute(sql`
    CREATE TABLE outbox (
      outbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL, business_unit_id UUID NOT NULL, depot_id UUID NOT NULL, legal_entity_id UUID NOT NULL,
      queue_name VARCHAR(64) NOT NULL,
      payload JSONB NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      attempts BIGINT NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

describe('@fleet/api - SyncService (integration)', () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('fleet_test').withReuse().start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema, casing: 'snake_case' });
    await applySchema(db);
    service = new SyncService(db);
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

  it('writes to all three append paths in one tx', async () => {
    const res = await service.processSync({ cursor: '0', actions: [makeAction('00000000-0000-0000-0000-000000000aa1')] }, OP);
    expect(res.status).toBe('ok');
    expect(res.results).toEqual(['applied']);

    const audit = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM fleet_audit_log`);
    const feed = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM sync_change_feed`);
    const outboxCount = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM outbox`);
    expect(audit.rows[0]?.count).toBe('1');
    expect(feed.rows[0]?.count).toBe('1');
    expect(outboxCount.rows[0]?.count).toBe('1');
  });

  it('returns duplicate for second submission of same action_id', async () => {
    const a = makeAction('00000000-0000-0000-0000-000000000aa2');
    const r1 = await service.processSync({ cursor: '0', actions: [a] }, OP);
    const r2 = await service.processSync({ cursor: r1.newCursor, actions: [a] }, OP);
    expect(r1.results).toEqual(['applied']);
    expect(r2.results).toEqual(['duplicate']);
  });

  it('assigns monotonically increasing server_seq', async () => {
    await service.processSync({
      cursor: '0',
      actions: [
        makeAction('00000000-0000-0000-0000-000000000aa3'),
        makeAction('00000000-0000-0000-0000-000000000aa4'),
        makeAction('00000000-0000-0000-0000-000000000aa5'),
      ],
    }, OP);
    const rows = await db.execute<{ server_seq: string }>(sql`SELECT server_seq::text FROM sync_change_feed ORDER BY server_seq`);
    expect(rows.rows.map((r) => r.server_seq)).toEqual(['1', '2', '3']);
  });

  it('newCursor reflects max server_seq', async () => {
    const res = await service.processSync({
      cursor: '0',
      actions: [makeAction('00000000-0000-0000-0000-000000000aa6'), makeAction('00000000-0000-0000-0000-000000000aa7')],
    }, OP);
    expect(res.newCursor).toBe('2');
    expect(res.eventSeq).toBe(2);
  });

  it('deltasAfter returns rows after cursor in seq order', async () => {
    await service.processSync({
      cursor: '0',
      actions: [
        makeAction('00000000-0000-0000-0000-000000000aa8'),
        makeAction('00000000-0000-0000-0000-000000000aa9'),
        makeAction('00000000-0000-0000-0000-000000000aaa'),
      ],
    }, OP);
    const deltas = await service.deltasAfter('1', OP);
    expect(deltas.map((d) => d.serverSeq)).toEqual(['2', '3']);
  });

  it('isolates by company_id (no cross-tenant leak)', async () => {
    const otherTenant: OperatorContext = { ...OP, companyId: '00000000-0000-0000-0000-0000000000ff' };
    await service.processSync({ cursor: '0', actions: [makeAction('00000000-0000-0000-0000-000000000ab1')] }, OP);
    const otherDeltas = await service.deltasAfter('0', otherTenant);
    expect(otherDeltas).toHaveLength(0);
  });
});
