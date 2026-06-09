// apps/api/test/outbox-relay.service.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
import { rowsOf } from './helpers/integration-rows.js';

let testDb: MigratedTestDb;
const COMPANY = '00000000-0000-0000-0000-000000000003';
const BU = '00000000-0000-0000-0000-000000000004';
const DEPOT = '00000000-0000-0000-0000-000000000005';
const LE = '00000000-0000-0000-0000-000000000006';

interface FakeQueue {
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function fakeQueue(): FakeQueue {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

interface RelayHarness {
  readonly svc: OutboxRelayService;
  readonly queues: Record<string, FakeQueue>;
}

function makeRelay(): RelayHarness {
  const queues: Record<string, FakeQueue> = {
    projections: fakeQueue(),
    erp: fakeQueue(),
    intake: fakeQueue(),
    'outbox-dead-letter': fakeQueue(),
  };
  const svc = new (OutboxRelayService as unknown as new (db: unknown, conn: unknown) => OutboxRelayService)(
    testDb.db,
    { host: 'localhost', port: 6379 },
  );
  const getQueue = (name: string): FakeQueue => {
    let q = queues[name];
    if (!q) {
      q = fakeQueue();
      queues[name] = q;
    }
    return q;
  };
  Object.assign(svc as unknown as { getQueue: typeof getQueue }, { getQueue });
  return { svc, queues };
}

describe('@fleet/api - OutboxRelayService (integration)', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_outbox_relay_int'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => { await testDb.db.execute(sql`TRUNCATE TABLE outbox CASCADE`); });

  it('drains pending row, enqueues to projections, marks sent', async () => {
    await testDb.db.execute(sql`
      INSERT INTO outbox (outbox_id, company_id, business_unit_id, depot_id, legal_entity_id, queue_name, payload, status, attempts, created_at)
      VALUES (gen_random_uuid(), ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, 'projections',
              '{"aggregateType":"road_run","eventType":"road_run_started"}'::jsonb,
              'pending', 0, now())
    `);
    const { svc, queues } = makeRelay();
    await svc.drainOnce();
    const rows = await testDb.db.execute(sql`SELECT status FROM outbox`);
    const r = rowsOf<{ status: string }>(rows as unknown as { rows: readonly { status: string }[] });
    expect(r[0]?.status).toBe('sent');
    const projAdd = queues['projections']?.add;
    if (!projAdd) throw new Error('projections queue missing');
    expect(projAdd).toHaveBeenCalledTimes(1);
    // The relay strips the routing envelope ({aggregateType,eventType,serverSeq})
    // before enqueue, so the BullMQ job body no longer carries those fields. This
    // projections payload is envelope-only, so the enqueued body is {}. Routing
    // still used the envelope; the job name + jobId are unaffected.
    expect(projAdd).toHaveBeenCalledWith(
      'road_run_started',
      expect.not.objectContaining({ aggregateType: expect.anything(), eventType: expect.anything() }),
      expect.objectContaining({ jobId: expect.any(String) }),
    );
  });

  it('FOR UPDATE SKIP LOCKED prevents concurrent double-pickup', async () => {
    await testDb.db.execute(sql`
      INSERT INTO outbox (outbox_id, company_id, business_unit_id, depot_id, legal_entity_id, queue_name, payload, status, attempts, created_at)
      VALUES (gen_random_uuid(), ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, 'projections',
              '{"aggregateType":"road_run","eventType":"road_run_started"}'::jsonb,
              'pending', 0, now())
    `);
    const a = makeRelay();
    const b = makeRelay();
    await Promise.all([a.svc.drainOnce(), b.svc.drainOnce()]);
    const aAdd = a.queues['projections']?.add;
    const bAdd = b.queues['projections']?.add;
    if (!aAdd || !bAdd) throw new Error('projections queue missing');
    const totalAddCalls = aAdd.mock.calls.length + bAdd.mock.calls.length;
    expect(totalAddCalls).toBe(1);
  });

  it('marks invalid_payload row as dead_letter', async () => {
    await testDb.db.execute(sql`
      INSERT INTO outbox (outbox_id, company_id, business_unit_id, depot_id, legal_entity_id, queue_name, payload, status, attempts, created_at)
      VALUES (gen_random_uuid(), ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, 'projections',
              '{"missing":"fields"}'::jsonb, 'pending', 0, now())
    `);
    const { svc } = makeRelay();
    await svc.drainOnce();
    const rows = await testDb.db.execute(sql`SELECT status FROM outbox`);
    const r = rowsOf<{ status: string }>(rows as unknown as { rows: readonly { status: string }[] });
    expect(r[0]?.status).toBe('dead_letter');
  });
});
