// apps/api/test/outbox-relay.service.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
import { rowsOf } from './helpers/integration-rows.js';

let testDb: MigratedTestDb;
const COMPANY = '00000000-0000-0000-0000-000000000003';
const BU = '00000000-0000-0000-0000-000000000004';
const DEPOT = '00000000-0000-0000-0000-000000000005';
const LE = '00000000-0000-0000-0000-000000000006';

function fakeQueue(): Queue {
  return { add: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
}

function makeRelay(): { svc: OutboxRelayService; queues: Record<string, Queue> } {
  const queues = { projections: fakeQueue(), erp: fakeQueue(), intake: fakeQueue(), 'outbox-dead-letter': fakeQueue() };
  const ctor = OutboxRelayService.prototype.constructor as unknown as new (db: unknown, queues: unknown) => OutboxRelayService;
  // Try the real DI shape; production uses BULLMQ_CONNECTION + factory. Here we patch private queue map.
  const svc = new (OutboxRelayService as unknown as new (db: unknown, conn: unknown) => OutboxRelayService)(testDb.db, { host: 'localhost', port: 6379 });
  // Inject our fake queues directly via reflection on the private getQueue map
  Object.assign(svc as unknown as { queues: Record<string, Queue> }, { queues });
  // Override getQueue to return our fakes
  (svc as unknown as { getQueue: (name: string) => Queue }).getQueue = (name: string) => {
    if (queues[name]) return queues[name];
    queues[name] = fakeQueue();
    return queues[name];
  };
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
    const r = rowsOf<{ status: string }>(rows);
    expect(r[0]?.status).toBe('sent');
    const projAdd = queues['projections']?.add as ReturnType<typeof vi.fn>;
    expect(projAdd).toHaveBeenCalledTimes(1);
    // #692: verify the actual payload, not just call count
    expect(projAdd).toHaveBeenCalledWith(
      'road_run_started',
      expect.objectContaining({ aggregateType: 'road_run', eventType: 'road_run_started' }),
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
    const totalAddCalls = (a.queues['projections']?.add as ReturnType<typeof vi.fn>).mock.calls.length + (b.queues['projections']?.add as ReturnType<typeof vi.fn>).mock.calls.length;
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
    const r = rowsOf<{ status: string }>(rows);
    expect(r[0]?.status).toBe('dead_letter');
  });
});
