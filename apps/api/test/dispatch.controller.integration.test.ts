// apps/api/test/dispatch.controller.integration.test.ts
// PGLite integration: real dispatch_board_projection table, real tenant filter.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { DispatchController } from '../src/dispatch/dispatch.controller.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;
let ctrl: DispatchController;
const OP = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000aaa' });

async function insertProjection(roadRunId: string, plannedAt: string | null, opts: { companyId?: string } = {}): Promise<void> {
  const co = opts.companyId ?? OP.companyId;
  await testDb.db.execute(sql.raw(`
    INSERT INTO dispatch_board_projection
      (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id,
       state, stop_count, transport_order_refs, server_seq, planned_start_at)
    VALUES
      ('${roadRunId}', '${co}', '${co}', '${co}', '${co}',
       'planned', 2, '["TO-1","TO-2"]'::jsonb, 1, ${plannedAt ? `'${plannedAt}'` : 'NULL'})
  `));
}

describe('@fleet/api - DispatchController.getBoard (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    ctrl = new DispatchController(testDb.db as never);
  }, 30_000);
  afterAll(async () => stopPgliteTestDb(testDb));
  beforeEach(async () => {
    await testDb.db.execute(sql`TRUNCATE TABLE dispatch_board_projection CASCADE`);
  });

  it('returns mapped rows scoped to operator companyId', async () => {
    await insertProjection('aaaaaaaa-1111-4111-8111-111111111111', '2026-04-29T12:00:00.000Z');
    const result = await ctrl.getBoard(OP);
    expect(result.rows).toHaveLength(1);
    const r = result.rows[0]; if (!r) throw new Error('expected row');
    expect(r.plannedStartAt).toBe('2026-04-29T12:00:00.000Z');
    expect(r.transportOrderRefs).toEqual(['TO-1', 'TO-2']);
  });

  it('serializes null plannedStartAt', async () => {
    await insertProjection('bbbbbbbb-1111-4111-8111-111111111111', null);
    const result = await ctrl.getBoard(OP);
    const r = result.rows[0]; if (!r) throw new Error('expected row');
    expect(r.plannedStartAt).toBeNull();
  });

  it('returns empty rows when projection has no data for operator scope', async () => {
    const result = await ctrl.getBoard(OP);
    expect(result.rows).toEqual([]);
  });

  it('isolates by company_id (no cross-tenant leak)', async () => {
    const otherCo = '00000000-0000-0000-0000-000000000bbb';
    await insertProjection('cccccccc-1111-4111-8111-111111111111', '2026-04-29T12:00:00.000Z');
    await insertProjection('dddddddd-1111-4111-8111-111111111111', '2026-04-29T12:00:00.000Z', { companyId: otherCo });
    const result = await ctrl.getBoard(OP);
    expect(result.rows).toHaveLength(1);
    const r = result.rows[0]; if (!r) throw new Error('expected row');
    expect(r.roadRunId).toBe('cccccccc-1111-4111-8111-111111111111');
  });
});
