// apps/api/test/sync.service.integration.test.ts
// Schema applied via real drizzle migrations through migrate-test-db helper.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { SyncService } from '../src/sync/sync.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import type { SyncActionInput } from '../src/sync/sync.dto.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;
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

describe('@fleet/api - SyncService (integration)', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test');
    service = new SyncService(testDb.db);
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

  it('writes to all three append paths in one tx', async () => {
    const res = await service.processSync({ cursor: '0', actions: [makeAction('00000000-0000-0000-0000-000000000aa1')] }, OP);
    expect(res.status).toBe('ok');
    expect(res.results).toEqual(['applied']);
    const audit = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM fleet_audit_log`);
    const feed = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM sync_change_feed`);
    const outboxCount = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM outbox`);
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
    const rows = await testDb.db.execute<{ server_seq: string }>(sql`SELECT server_seq::text FROM sync_change_feed ORDER BY server_seq`);
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
