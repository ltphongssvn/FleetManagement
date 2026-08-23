// apps/api/test/admin-order-timeline.integration.test.ts
// PGLite integration (RED-first): GET /admin/orders/:externalRef/timeline must
// return the Zod-validated, time-ordered business event stream for ONE order —
// replacing ad-hoc psql forensics. Mirrors dispatch.controller.integration.test.ts
// harness: real tables, real tenant filter, controller invoked directly.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { OrderTimelineSchema } from '@fleet/sync-protocol';
import { AdminOrderTimelineController } from '../src/admin/admin-order-timeline.controller.js';
import { AdminOrderTimelineService } from '../src/admin/admin-order-timeline.service.js';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;
let ctrl: AdminOrderTimelineController;
const OP = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000aaa' });
const OTHER_CO = '00000000-0000-0000-0000-000000000bbb';
const TO = '44444444-aaaa-4aaa-8aaa-444444444444';
const RR = '55555555-aaaa-4aaa-8aaa-555555555555';
const S1 = '66666666-aaaa-4aaa-8aaa-666666666666';
const M1 = '77777777-aaaa-4aaa-8aaa-777777777777';
const M2 = '88888888-aaaa-4aaa-8aaa-888888888888';

function q(v: string): string {
  return String.fromCharCode(39) + v + String.fromCharCode(39);
}
function tenancy(co: string): string {
  return q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co);
}
async function seedOrderGraph(
  co: string,
  ref: string,
  toId: string,
  rrId: string,
  stopId: string,
): Promise<void> {
  await testDb.db.execute(
    sql.raw(
      'INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, external_ref, created_at, updated_at) VALUES (' +
        q(toId) +
        ', ' +
        tenancy(co) +
        ', ' +
        q(ref) +
        ', ' +
        q('2026-06-11T08:00:00.000Z') +
        ', now())',
    ),
  );
  await testDb.db.execute(
    sql.raw(
      'INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id, started_at, completed_at, created_at) VALUES (' +
        q(rrId) +
        ', ' +
        tenancy(co) +
        ', ' +
        q('completed') +
        ', ' +
        q(co) +
        ', ' +
        q(co) +
        ', ' +
        q('2026-06-11T09:00:00.000Z') +
        ', ' +
        q('2026-06-11T14:00:00.000Z') +
        ', ' +
        q('2026-06-11T08:05:00.000Z') +
        ')',
    ),
  );
  await testDb.db.execute(
    sql.raw(
      'INSERT INTO road_run_transport_order (road_run_id, transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, sequence) VALUES (' +
        q(rrId) +
        ', ' +
        q(toId) +
        ', ' +
        tenancy(co) +
        ', 1)',
    ),
  );
  await testDb.db.execute(
    sql.raw(
      'INSERT INTO stop (stop_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type, arrived_at, departed_at) VALUES (' +
        q(stopId) +
        ', ' +
        tenancy(co) +
        ', ' +
        q(toId) +
        ', 1, ' +
        q('pickup') +
        ', ' +
        q('2026-06-11T09:30:00.000Z') +
        ', ' +
        q('2026-06-11T10:00:00.000Z') +
        ')',
    ),
  );
}
async function seedManifest(
  id: string,
  co: string,
  toId: string,
  stopId: string | null,
  state: string,
  createdAt: string,
  committedAt: string | null,
  reason: string | null,
): Promise<void> {
  await testDb.db.execute(
    sql.raw(
      'INSERT INTO manifest (manifest_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, manifest_correlation_id, state, stop_id, created_at, committed_at, rejection_reason_text) VALUES (' +
        q(id) +
        ', ' +
        tenancy(co) +
        ', ' +
        q(toId) +
        ', ' +
        q(id) +
        ', ' +
        q(state) +
        ', ' +
        (stopId === null ? 'NULL' : q(stopId)) +
        ', ' +
        q(createdAt) +
        ', ' +
        (committedAt === null ? 'NULL' : q(committedAt)) +
        ', ' +
        (reason === null ? 'NULL' : q(reason)) +
        ')',
    ),
  );
}

describe('@fleet/api - AdminOrderTimelineController (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    ctrl = new AdminOrderTimelineController(new AdminOrderTimelineService(testDb.db as never));
  });
  afterAll(async () => stopPgliteTestDb(testDb));
  beforeEach(async () => {
    for (const t of [
      'manifest',
      'stop',
      'road_run_transport_order',
      'road_run',
      'transport_order',
    ]) {
      await testDb.db.execute(sql.raw('TRUNCATE TABLE ' + t + ' CASCADE'));
    }
  });

  it('returns the full ordered event stream and validates against the contract', async () => {
    await seedOrderGraph(OP.companyId, 'XTT.06-006', TO, RR, S1);
    await seedManifest(
      M1,
      OP.companyId,
      TO,
      S1,
      'committed',
      '2026-06-11T09:40:00.000Z',
      '2026-06-11T09:45:00.000Z',
      null,
    );
    const res = await ctrl.timeline('XTT.06-006', OP);
    const parsed = OrderTimelineSchema.parse(res);
    expect(parsed.externalRef).toBe('XTT.06-006');
    const types = parsed.events.map((e) => e.eventType);
    expect(types).toEqual([
      'order_created',
      'run_created',
      'run_started',
      'stop_arrived',
      'manifest_negotiated',
      'manifest_committed',
      'stop_departed',
      'run_completed',
    ]);
    const ats = parsed.events.map((e) => e.at);
    expect([...ats].sort()).toEqual(ats);
    const committed = parsed.events.find((e) => e.eventType === 'manifest_committed');
    expect(committed?.boundStopSequence).toBe(1);
  });

  it('surfaces legacy unbound manifests with boundStopSequence null and rejected with reasonText', async () => {
    await seedOrderGraph(OP.companyId, 'XTT.06-007', TO, RR, S1);
    await seedManifest(
      M1,
      OP.companyId,
      TO,
      null,
      'committed',
      '2026-06-11T09:40:00.000Z',
      '2026-06-11T09:45:00.000Z',
      null,
    );
    await seedManifest(
      M2,
      OP.companyId,
      TO,
      null,
      'rejected',
      '2026-06-11T09:50:00.000Z',
      null,
      'object_missing',
    );
    const res = await ctrl.timeline('XTT.06-007', OP);
    const committed = res.events.find((e) => e.eventType === 'manifest_committed');
    expect(committed?.boundStopSequence).toBeNull();
    const rejected = res.events.find((e) => e.eventType === 'manifest_rejected');
    expect(rejected?.reasonText).toBe('object_missing');
  });

  it('emits order_cancelled when the order carries cancellation columns', async () => {
    await seedOrderGraph(OP.companyId, 'XTT.06-008', TO, RR, S1);
    await testDb.db.execute(
      sql.raw(
        'UPDATE transport_order SET cancelled_at=' +
          q('2026-06-11T11:00:00.000Z') +
          ', cancellation_reason=' +
          q('customer_request') +
          ' WHERE transport_order_id=' +
          q(TO),
      ),
    );
    const res = await ctrl.timeline('XTT.06-008', OP);
    const ev = res.events.find((e) => e.eventType === 'order_cancelled');
    expect(ev?.reason).toBe('customer_request');
  });

  // The column is plain text and predates the vocabulary, so it is external
  // input even though the database is ours. A value outside CANCEL_REASONS is
  // legacy or corrupt data, not a reason: it degrades to null -- which the
  // contract already admits -- rather than reaching an admin consumer as if it
  // were canonical. Before the contract was narrowed this parsed as a plain
  // string and shipped verbatim.
  it('degrades an out-of-vocabulary cancellation reason to null', async () => {
    await seedOrderGraph(OP.companyId, 'XTT.06-011', TO, RR, S1);
    await testDb.db.execute(
      sql.raw(
        'UPDATE transport_order SET cancelled_at=' +
          q('2026-06-11T11:00:00.000Z') +
          ', cancellation_reason=' +
          q('custmer_request') +
          ' WHERE transport_order_id=' +
          q(TO),
      ),
    );
    const res = await ctrl.timeline('XTT.06-011', OP);
    const ev = res.events.find((e) => e.eventType === 'order_cancelled');
    expect(ev?.reason).toBeNull();
    // Still a valid contract document -- degradation must not produce a payload
    // the schema rejects.
    expect(OrderTimelineSchema.safeParse(res).success).toBe(true);
  });

  it('keeps a null cancellation reason null', async () => {
    await seedOrderGraph(OP.companyId, 'XTT.06-012', TO, RR, S1);
    await testDb.db.execute(
      sql.raw(
        'UPDATE transport_order SET cancelled_at=' +
          q('2026-06-11T11:00:00.000Z') +
          ' WHERE transport_order_id=' +
          q(TO),
      ),
    );
    const res = await ctrl.timeline('XTT.06-012', OP);
    const ev = res.events.find((e) => e.eventType === 'order_cancelled');
    expect(ev?.reason).toBeNull();
  });

  it('404s for an unknown externalRef', async () => {
    await expect(ctrl.timeline('XTT.99-999', OP)).rejects.toMatchObject({ status: 404 });
  });

  it('404s across tenants (order exists under another company)', async () => {
    await seedOrderGraph(OTHER_CO, 'XTT.06-009', TO, RR, S1);
    await expect(ctrl.timeline('XTT.06-009', OP)).rejects.toMatchObject({ status: 404 });
  });

  it('covers in-flight orders: run not started, stop untouched, verifying + defensively-null committedAt manifests', async () => {
    const co = OP.companyId;
    await testDb.db.execute(
      sql.raw(
        'INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, external_ref, created_at, updated_at) VALUES (' +
          q(TO) +
          ', ' +
          tenancy(co) +
          ', ' +
          q('XTT.06-010') +
          ', ' +
          q('2026-06-11T08:00:00.000Z') +
          ', now())',
      ),
    );
    await testDb.db.execute(
      sql.raw(
        'INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id, created_at) VALUES (' +
          q(RR) +
          ', ' +
          tenancy(co) +
          ', ' +
          q('planned') +
          ', ' +
          q(co) +
          ', ' +
          q(co) +
          ', ' +
          q('2026-06-11T08:05:00.000Z') +
          ')',
      ),
    );
    await testDb.db.execute(
      sql.raw(
        'INSERT INTO road_run_transport_order (road_run_id, transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, sequence) VALUES (' +
          q(RR) +
          ', ' +
          q(TO) +
          ', ' +
          tenancy(co) +
          ', 1)',
      ),
    );
    await testDb.db.execute(
      sql.raw(
        'INSERT INTO stop (stop_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type) VALUES (' +
          q(S1) +
          ', ' +
          tenancy(co) +
          ', ' +
          q(TO) +
          ', 1, ' +
          q('pickup') +
          ')',
      ),
    );
    await seedManifest(M1, co, TO, S1, 'verifying', '2026-06-11T09:40:00.000Z', null, null);
    await seedManifest(M2, co, TO, S1, 'committed', '2026-06-11T09:50:00.000Z', null, null);
    const res = await ctrl.timeline('XTT.06-010', OP);
    const types = res.events.map((e) => e.eventType);
    expect(types).toEqual([
      'order_created',
      'run_created',
      'manifest_negotiated',
      'manifest_negotiated',
    ]);
  });
});
