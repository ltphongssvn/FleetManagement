// apps/api/test/dispatch.controller.pagination.integration.test.ts
// PGLite integration (RED-first) for the paginated + status-partitioned dispatch
// board. Drives DispatchController.getBoardPage(op, query): offset/page-number
// pagination over dispatch_board_projection, filtered by status group (active =
// planned|dispatched|started; finished = completed; cancelled = cancelled), the SSOT
// paginated envelope (data + page/pageSize/total/totalPages/hasMore) that
// validates against @fleet/sync-protocol DispatchBoardPageApiResponseSchema.
// Mirrors dispatch.controller.integration.test.ts (real projection table, real
// tenant filter). getBoardPage + the page schema do not exist yet => RED.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { DispatchController } from '../src/dispatch/dispatch.controller.js';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import { DispatchBoardPageApiResponseSchema } from '@fleet/sync-protocol';

let testDb: PgliteTestDb;
let ctrl: DispatchController;
const OP = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000aaa' });

function q(v: string): string {
  return String.fromCharCode(39) + v + String.fromCharCode(39);
}

async function insertRow(
  roadRunId: string,
  state: string,
  plannedAt: string,
  opts: { companyId?: string } = {},
): Promise<void> {
  const co = opts.companyId ?? OP.companyId;
  await testDb.db.execute(
    sql.raw(
      'INSERT INTO dispatch_board_projection ' +
        '(road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, stop_count, transport_order_refs, server_seq, planned_start_at) ' +
        'VALUES (' +
        q(roadRunId) +
        ', ' +
        q(co) +
        ', ' +
        q(co) +
        ', ' +
        q(co) +
        ', ' +
        q(co) +
        ', ' +
        q(state) +
        ', 1, ' +
        q('["TO-1"]') +
        '::jsonb, 1, ' +
        q(plannedAt) +
        ')',
    ),
  );
}

// Deterministic per-index road_run UUID.
function rr(n: number): string {
  return 'aaaaaaaa-1111-4111-8111-0000000000' + n.toString(16).padStart(2, '0');
}
// Increasing planned_start_at so plannedStartAt ordering is deterministic.
function plannedAt(n: number): string {
  return '2026-06-' + n.toString().padStart(2, '0') + 'T08:00:00.000Z';
}

beforeAll(async () => {
  testDb = await startPgliteTestDb();
  ctrl = new DispatchController(testDb.db as never);
});
afterAll(async () => stopPgliteTestDb(testDb));
beforeEach(async () => {
  await testDb.db.execute(sql.raw('TRUNCATE TABLE dispatch_board_projection CASCADE'));
});

describe('@fleet/api - DispatchController.getBoardPage (paginated + status partition)', () => {
  it('active group returns only planned/dispatched/started rows', async () => {
    await insertRow(rr(1), 'planned', plannedAt(1));
    await insertRow(rr(2), 'dispatched', plannedAt(2));
    await insertRow(rr(3), 'started', plannedAt(3));
    await insertRow(rr(4), 'completed', plannedAt(4));
    await insertRow(rr(5), 'cancelled', plannedAt(5));
    const page = await ctrl.getBoardPage(OP, { group: 'active', page: 1, pageSize: 20 });
    expect(page.data.map((r) => r.state).sort()).toEqual(['dispatched', 'planned', 'started']);
    expect(page.total).toBe(3);
  });

  it('finished group returns only completed rows (cancelled split to its own group)', async () => {
    await insertRow(rr(1), 'planned', plannedAt(1));
    await insertRow(rr(4), 'completed', plannedAt(4));
    await insertRow(rr(5), 'cancelled', plannedAt(5));
    const page = await ctrl.getBoardPage(OP, { group: 'finished', page: 1, pageSize: 20 });
    expect(page.data.map((r) => r.state).sort()).toEqual(['completed']);
    expect(page.total).toBe(1);
  });
  it('cancelled group returns only cancelled rows (T16 Lenh Huy tab)', async () => {
    await insertRow(rr(1), 'planned', plannedAt(1));
    await insertRow(rr(4), 'completed', plannedAt(4));
    await insertRow(rr(5), 'cancelled', plannedAt(5));
    const page = await ctrl.getBoardPage(OP, { group: 'cancelled', page: 1, pageSize: 20 });
    expect(page.data.map((r) => r.state).sort()).toEqual(['cancelled']);
    expect(page.total).toBe(1);
  });

  it('paginates: pageSize 2 over 5 active rows -> page1=2, total=5, totalPages=3, hasMore=true', async () => {
    for (let i = 1; i <= 5; i += 1) await insertRow(rr(i), 'planned', plannedAt(i));
    const p1 = await ctrl.getBoardPage(OP, { group: 'active', page: 1, pageSize: 2 });
    expect(p1.data).toHaveLength(2);
    expect(p1.total).toBe(5);
    expect(p1.totalPages).toBe(3);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(2);
    expect(p1.hasMore).toBe(true);
  });

  it('last page returns the remainder with hasMore=false', async () => {
    for (let i = 1; i <= 5; i += 1) await insertRow(rr(i), 'planned', plannedAt(i));
    const p3 = await ctrl.getBoardPage(OP, { group: 'active', page: 3, pageSize: 2 });
    expect(p3.data).toHaveLength(1);
    expect(p3.hasMore).toBe(false);
  });

  it('page slices are disjoint and ordered by plannedStartAt', async () => {
    for (let i = 1; i <= 5; i += 1) await insertRow(rr(i), 'planned', plannedAt(i));
    const p1 = await ctrl.getBoardPage(OP, { group: 'active', page: 1, pageSize: 2 });
    const p2 = await ctrl.getBoardPage(OP, { group: 'active', page: 2, pageSize: 2 });
    const ids1 = p1.data.map((r) => r.roadRunId);
    const ids2 = p2.data.map((r) => r.roadRunId);
    expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
    expect(p1.data[0]?.plannedStartAt).toBe(plannedAt(1));
  });

  it('isolates by company_id (no cross-tenant leak)', async () => {
    await insertRow(rr(1), 'planned', plannedAt(1));
    await insertRow(rr(2), 'planned', plannedAt(2), {
      companyId: '00000000-0000-0000-0000-000000000bbb',
    });
    const page = await ctrl.getBoardPage(OP, { group: 'active', page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
    expect(page.data[0]?.roadRunId).toBe(rr(1));
  });

  it('response validates against the SSOT paginated envelope schema', async () => {
    await insertRow(rr(1), 'planned', plannedAt(1));
    const page = await ctrl.getBoardPage(OP, { group: 'active', page: 1, pageSize: 20 });
    expect(() => DispatchBoardPageApiResponseSchema.parse(page)).not.toThrow();
  });
});
