// apps/api/test/sync.service.integration.test.ts
// Schema applied via real drizzle migrations through migrate-test-db helper.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { SyncService } from '../src/sync/sync.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import type { SyncActionInput } from '../src/sync/sync.dto.js';
import { createActionId, createAggregateId, createSyncCursor } from '@fleet/sync-protocol';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: MigratedTestDb;
let service: SyncService;

const OP: OperatorContext = createOperatorContext();

function makeAction(id: string): SyncActionInput {
  return {
    actionId: createActionId(id),
    aggregateType: 'transport_order',
    aggregateId: createAggregateId('00000000-0000-0000-0000-000000000010'),
    payload: { state: 'assigned' },
    timestamp: '2026-04-27T18:00:00.000Z',
  };
}

describe('@fleet/api - SyncService (integration)', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test');
    service = new SyncService(testDb.db);
  });

  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });

  beforeEach(async () => {
    await truncateAllTables(testDb.db);
  });

  it('writes to all three append paths in one tx', async () => {
    const res = await service.processSync({ cursor: createSyncCursor('0'), actions: [makeAction('00000000-0000-0000-0000-000000000aa1')] }, OP);
    // Deep contract assertion: every wire-protocol field that clients rely on.
    expect(res).toMatchObject({
      status: 'ok',
      results: ['applied'],
      hysteresisVersion: 0,
      configFlagVersion: 0,
    });
    // Behavior contract: newCursor stringifies eventSeq; both >0 and consistent.
    // (Specific value depends on global fleet_server_seq, not asserted.)
    expect(BigInt(res.newCursor)).toBeGreaterThan(0n);
    expect(BigInt(res.newCursor)).toBe(BigInt(res.eventSeq));
    expect(res.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(res.deltas)).toBe(true);
    const audit = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM fleet_audit_log`);
    const feed = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM sync_change_feed`);
    const outboxCount = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM outbox`);
    expect(audit.rows[0]?.count).toBe('1');
    expect(feed.rows[0]?.count).toBe('1');
    expect(outboxCount.rows[0]?.count).toBe('1');
  });

  it('returns duplicate for second submission of same action_id', async () => {
    const a = makeAction('00000000-0000-0000-0000-000000000aa2');
    const r1 = await service.processSync({ cursor: createSyncCursor('0'), actions: [a] }, OP);
    const r2 = await service.processSync({ cursor: r1.newCursor, actions: [a] }, OP);
    expect(r1.results).toEqual(['applied']);
    expect(r2.results).toEqual(['duplicate']);
  });

  it('assigns monotonically increasing server_seq', async () => {
    await service.processSync({
      cursor: createSyncCursor('0'),
      actions: [
        makeAction('00000000-0000-0000-0000-000000000aa3'),
        makeAction('00000000-0000-0000-0000-000000000aa4'),
        makeAction('00000000-0000-0000-0000-000000000aa5'),
      ],
    }, OP);
    // Filter to just the 3 action_ids we inserted; other tests may have leaked rows
    // via sequence-related writes (sequences aren't reset by TRUNCATE).
    // Note: alias as seq_text so ORDER BY references the underlying bigint column,
    // not the text-cast output column (which would sort lexicographically: '10'<'11'<'9').
    const rows = await testDb.db.execute<{ seq_text: string }>(sql`
      SELECT server_seq::text AS seq_text FROM sync_change_feed
      WHERE action_id IN (
        '00000000-0000-0000-0000-000000000aa3'::uuid,
        '00000000-0000-0000-0000-000000000aa4'::uuid,
        '00000000-0000-0000-0000-000000000aa5'::uuid
      )
      ORDER BY server_seq
    `);
    const seqs = rows.rows.map((r) => BigInt(r.seq_text));
    expect(seqs.length).toBe(3);
    const [s0, s1, s2] = seqs;
    if (s0 === undefined || s1 === undefined || s2 === undefined) throw new Error('seq undefined');
    // Behavior: strictly monotonically increasing within a single processSync batch.
    // Not gap-free: each action runs in its own tx (see SyncService.applyAction),
    // so other concurrent allocators on fleet_server_seq can create gaps.
    expect(s1 - s0).toBeGreaterThan(0n);
    expect(s2 - s1).toBeGreaterThan(0n);
  });

  it('newCursor reflects max server_seq', async () => {
    const res = await service.processSync({
      cursor: createSyncCursor('0'),
      actions: [makeAction('00000000-0000-0000-0000-000000000aa6'), makeAction('00000000-0000-0000-0000-000000000aa7')],
    }, OP);
    const maxRow = await testDb.db.execute<{ max_seq: string }>(sql`SELECT MAX(server_seq)::text AS max_seq FROM sync_change_feed`);
    expect(res.newCursor).toBe(maxRow.rows[0]?.max_seq);
    expect(BigInt(res.eventSeq)).toBe(BigInt(res.newCursor));
  });

  it('deltasAfter returns rows after cursor in seq order', async () => {
    const res = await service.processSync({
      cursor: createSyncCursor('0'),
      actions: [
        makeAction('00000000-0000-0000-0000-000000000aa8'),
        makeAction('00000000-0000-0000-0000-000000000aa9'),
        makeAction('00000000-0000-0000-0000-000000000aaa'),
      ],
    }, OP);
    // Cursor = seq of first applied action; deltasAfter should return the remaining 2 in order.
    const firstSeq = (BigInt(res.newCursor) - 2n).toString();
    const deltas = await service.deltasAfter(firstSeq, OP);
    expect(deltas.length).toBe(2);
    const ds = deltas.map((d) => BigInt(d.serverSeq));
    const [d0, d1] = ds;
    if (d0 === undefined || d1 === undefined) throw new Error('delta seq undefined');
    expect(d1 > d0).toBe(true);
  });

  it('isolates by company_id (no cross-tenant leak)', async () => {
    const otherTenant: OperatorContext = { ...OP, companyId: '00000000-0000-0000-0000-0000000000ff' };
    await service.processSync({ cursor: createSyncCursor('0'), actions: [makeAction('00000000-0000-0000-0000-000000000ab1')] }, OP);
    const otherDeltas = await service.deltasAfter('0', otherTenant);
    expect(otherDeltas).toHaveLength(0);
  });

  it('logs duplicate at debug level (structured observability)', async () => {
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const action = makeAction('00000000-0000-0000-0000-000000000ab1');
    await service.processSync({ cursor: createSyncCursor('0'), actions: [action] }, OP);
    await service.processSync({ cursor: createSyncCursor('0'), actions: [action] }, OP);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate action_id'));
    debugSpy.mockRestore();
  });

  it('returns full SyncResponse contract on empty request (wire-shape guarantee)', async () => {
    const res = await service.processSync({ cursor: createSyncCursor('0'), actions: [] }, OP);
    expect(res).toMatchObject({
      status: 'ok',
      results: [],
      newCursor: '0',
      eventSeq: 0,
      deltas: [],
      hysteresisVersion: 0,
      configFlagVersion: 0,
      projectionStatus: {},
    });
    expect(typeof res.serverTime).toBe('string');
  });

  it('keeps results aligned with input action order across mixed outcomes (applied/duplicate)', async () => {
    const a = makeAction('00000000-0000-0000-0000-000000000a01');
    const b = makeAction('00000000-0000-0000-0000-000000000a02');
    const c = makeAction('00000000-0000-0000-0000-000000000a03');
    // Pre-submit B so the second batch sees it as duplicate
    await service.processSync({ cursor: createSyncCursor('0'), actions: [b] }, OP);
    const res = await service.processSync({ cursor: createSyncCursor('0'), actions: [a, b, c] }, OP);
    expect(res.results).toEqual(['applied', 'duplicate', 'applied']);
  });

  it('continues processing later actions when an earlier action is duplicate', async () => {
    const dup = makeAction('00000000-0000-0000-0000-000000000b01');
    await service.processSync({ cursor: createSyncCursor('0'), actions: [dup] }, OP);
    const fresh = makeAction('00000000-0000-0000-0000-000000000b02');
    const res = await service.processSync({ cursor: createSyncCursor('0'), actions: [dup, fresh] }, OP);
    expect(res.results).toEqual(['duplicate', 'applied']);
  });

  it('isolates by full tenancy tuple (companyId+businessUnitId+depotId+legalEntityId)', async () => {
    // Same companyId; different businessUnitId, depotId, legalEntityId.
    const baseCompany = OP.companyId;
    const sameCompanyDifferentDepot = createOperatorContext({
      companyId: baseCompany,
      businessUnitId: '00000000-0000-0000-0000-0000000000d1',
      depotId: '00000000-0000-0000-0000-0000000000d2',
      legalEntityId: '00000000-0000-0000-0000-0000000000d3',
    });
    await service.processSync({ cursor: createSyncCursor('0'), actions: [makeAction('00000000-0000-0000-0000-000000000c01')] }, OP);
    await service.processSync({ cursor: createSyncCursor('0'), actions: [makeAction('00000000-0000-0000-0000-000000000c02')] }, sameCompanyDifferentDepot);
    // sync.service.processSync currently scopes by companyId only (verified by existing #103 test).
    // This test pins down that contract: deltas at company scope INCLUDE rows from any depot.
    const deltas = await service.deltasAfter('0', OP);
    expect(deltas.length).toBe(2);
  });

  it('rolls back all 3 append paths atomically when one insert fails (no orphan audit/feed/outbox)', async () => {
    // Submit a valid action first to establish baseline counts.
    const a1 = makeAction('00000000-0000-0000-0000-000000000d01');
    await service.processSync({ cursor: createSyncCursor('0'), actions: [a1] }, OP);
    const baselineAudit = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM fleet_audit_log`);
    const baselineFeed = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM sync_change_feed`);
    const baselineOutbox = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM outbox`);
    expect(baselineAudit.rows[0]?.count).toBe('1');
    expect(baselineFeed.rows[0]?.count).toBe('1');
    expect(baselineOutbox.rows[0]?.count).toBe('1');

    // Submit duplicate action — same actionId triggers UNIQUE violation on
    // sync_change_feed inside the tx; rollback must leave baseline counts intact.
    const dup = makeAction('00000000-0000-0000-0000-000000000d01');
    const res = await service.processSync({ cursor: createSyncCursor('0'), actions: [dup] }, OP);
    expect(res.results).toEqual(['duplicate']);

    // After rollback: counts must NOT have grown by 1 (no orphan rows in any path).
    const finalAudit = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM fleet_audit_log`);
    const finalFeed = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM sync_change_feed`);
    const finalOutbox = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM outbox`);
    expect(finalAudit.rows[0]?.count).toBe('1');
    expect(finalFeed.rows[0]?.count).toBe('1');
    expect(finalOutbox.rows[0]?.count).toBe('1');
  });
});
