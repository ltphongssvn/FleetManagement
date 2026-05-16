// apps/api/test/append-tri-write.test.ts
// RED test for shared appendTriWrite helper covering all 4 callsite shapes.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { appendTriWrite } from '../src/database/append-tri-write.js';
import { allocateServerSeq } from '../src/database/server-seq.repository.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: MigratedTestDb;
const OP = createOperatorContext();

describe('@fleet/api - appendTriWrite', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_atw'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await testDb.db.execute(sql`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename!='__drizzle_migrations')
        LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  });

  it('writes to all 3 append paths in one call (non-idempotent)', async () => {
    const aggregateId = randomUUID();
    const result = await testDb.db.transaction(async (tx) => {
      const serverSeq = await allocateServerSeq(tx);
      return appendTriWrite(tx, {
        serverSeq,
        actionId: randomUUID(),
        aggregateType: 'manifest',
        aggregateId,
        delta: { state: 'committed' },
        eventType: 'manifest.committed',
        auditPayload: { uploadSessionId: 'u-1' },
        operatorId: OP.operatorId,
        queueName: 'erp',
        outboxPayload: { aggregateType: 'manifest', eventType: 'manifest.committed' },
        op: OP,
      });
    });
    expect(result.duplicate).toBe(false);

    const counts = await testDb.db.execute<{ feed: string; audit: string; outbox: string }>(sql`
      SELECT
        (SELECT COUNT(*)::text FROM sync_change_feed WHERE aggregate_id = ${aggregateId}::uuid) AS feed,
        (SELECT COUNT(*)::text FROM fleet_audit_log WHERE aggregate_id = ${aggregateId}::uuid) AS audit,
        (SELECT COUNT(*)::text FROM outbox WHERE queue_name = 'erp') AS outbox
    `);
    expect(counts.rows[0]).toEqual({ feed: '1', audit: '1', outbox: '1' });
  }, 30_000);

  it('returns duplicate=true and skips audit/outbox when idempotent and actionId exists', async () => {
    const aggregateId = randomUUID();
    const actionId = randomUUID();
    const params = {
      actionId, aggregateType: 'command', aggregateId,
      delta: { type: 'x' }, eventType: 'command.issued',
      auditPayload: { commandId: actionId }, operatorId: OP.operatorId,
      queueName: 'projections', outboxPayload: { aggregateType: 'command' },
      op: OP, idempotent: true,
    } as const;

    const r1 = await testDb.db.transaction(async (tx) => {
      const seq = await allocateServerSeq(tx);
      return appendTriWrite(tx, { ...params, serverSeq: seq });
    });
    const r2 = await testDb.db.transaction(async (tx) => {
      const seq = await allocateServerSeq(tx);
      return appendTriWrite(tx, { ...params, serverSeq: seq });
    });

    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(true);

    const counts = await testDb.db.execute<{ feed: string; audit: string; outbox: string }>(sql`
      SELECT
        (SELECT COUNT(*)::text FROM sync_change_feed WHERE action_id = ${actionId}::uuid) AS feed,
        (SELECT COUNT(*)::text FROM fleet_audit_log WHERE aggregate_id = ${aggregateId}::uuid) AS audit,
        (SELECT COUNT(*)::text FROM outbox WHERE queue_name = 'projections') AS outbox
    `);
    expect(counts.rows[0]).toEqual({ feed: '1', audit: '1', outbox: '1' });
  }, 30_000);
  it('writes audit row with null operator_id when operatorId is omitted (line 72 branch)', async () => {
    const aggregateId = randomUUID();
    await testDb.db.transaction(async (tx) => {
      const serverSeq = await allocateServerSeq(tx);
      return appendTriWrite(tx, {
        serverSeq,
        actionId: randomUUID(),
        aggregateType: 'manifest',
        aggregateId,
        delta: { state: 'committed' },
        eventType: 'manifest.committed',
        auditPayload: { uploadSessionId: 'u-2' },
        // operatorId intentionally omitted -> exercises the : {} arm
        queueName: 'erp',
        outboxPayload: { aggregateType: 'manifest' },
        op: OP,
      });
    });
    const row = await testDb.db.execute<{ operator_id: string | null }>(sql`
      SELECT operator_id FROM fleet_audit_log WHERE aggregate_id = ${aggregateId}::uuid
    `);
    expect(row.rows[0]?.operator_id).toBeNull();
  }, 30_000);
});
