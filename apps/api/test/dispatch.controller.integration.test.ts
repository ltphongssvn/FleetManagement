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
function q(v: string): string {
  return String.fromCharCode(39) + v + String.fromCharCode(39);
}
async function insertProjection(roadRunId: string, plannedAt: string | null, opts: { companyId?: string } = {}): Promise<void> {
  const co = opts.companyId ?? OP.companyId;
  const planned = plannedAt ? q(plannedAt) : 'NULL';
  await testDb.db.execute(sql.raw(
    'INSERT INTO dispatch_board_projection ' +
    '(road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, stop_count, transport_order_refs, server_seq, planned_start_at) ' +
    'VALUES (' +
    q(roadRunId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' +
    q('planned') + ', 2, ' + q('["TO-1","TO-2"]') + '::jsonb, 1, ' + planned + ')'
  ));
}
async function seedStopChain(roadRunId: string, transportOrderId: string): Promise<void> {
  const co = OP.companyId;
  const wid = '11111111-aaaa-4aaa-8aaa-111111111111';
  const sid = '22222222-aaaa-4aaa-8aaa-222222222222';
  const cid = '33333333-aaaa-4aaa-8aaa-333333333333';
  const gaoId = '77777777-aaaa-4aaa-8aaa-777777777777';
  const gaoName = 'Gao';
  await testDb.db.execute(sql.raw(
    'INSERT INTO customer (customer_id, company_id, business_unit_id, depot_id, legal_entity_id, name, phone) ' +
    'VALUES (' + q(cid) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q('Công ty Vận Tải Số 1') + ', ' + q('0901234567') + ')'
  ));
  await testDb.db.execute(sql.raw(
    'INSERT INTO cargo_type (cargo_type_id, company_id, business_unit_id, depot_id, legal_entity_id, name) ' +
    'VALUES (' + q(gaoId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(gaoName) + ')'
  ));
  await testDb.db.execute(sql.raw(
    'INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, external_ref, customer_id, cargo_type_id, created_at, updated_at) ' +
    'VALUES (' + q(transportOrderId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q('XTT.05-001') + ', ' + q(cid) + ', ' + q(gaoId) + ', now(), now())'
  ));
  await testDb.db.execute(sql.raw(
    'INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id) ' +
    'VALUES (' + q(roadRunId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q('planned') + ', ' + q(co) + ', ' + q(co) + ')'
  ));
  await testDb.db.execute(sql.raw(
    'INSERT INTO road_run_transport_order (road_run_id, transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, sequence) ' +
    'VALUES (' + q(roadRunId) + ', ' + q(transportOrderId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', 1)'
  ));
  await testDb.db.execute(sql.raw(
    'INSERT INTO warehouse (warehouse_id, company_id, business_unit_id, depot_id, legal_entity_id, name, role) ' +
    'VALUES (' + q(wid) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q('Chơn Chính') + ', ' + q('pickup') + ')'
  ));
  await testDb.db.execute(sql.raw(
    'INSERT INTO stop (stop_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type, yard_id, planned_at, arrived_at, departed_at) ' +
    'VALUES (' + q(sid) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(transportOrderId) + ', 1, ' + q('pickup') + ', ' + q(wid) + ', ' + q('2026-05-30T08:00:00.000Z') + ', ' + q('2026-05-30T09:00:00.000Z') + ', ' + q('2026-05-30T09:15:00.000Z') + ')'
  ));
}
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    ctrl = new DispatchController(testDb.db as never);
  });
  afterAll(async () => stopPgliteTestDb(testDb));
  beforeEach(async () => {
    await testDb.db.execute(sql.raw('TRUNCATE TABLE dispatch_board_projection CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE stop CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE road_run_transport_order CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE transport_order CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE warehouse CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE customer CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE cargo_type CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE upload_session CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE manifest CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE road_run CASCADE'));
  });

describe('@fleet/api - DispatchController.getBoard (integration)', () => {
  it('returns mapped rows scoped to operator companyId', async () => {
    await insertProjection('aaaaaaaa-1111-4111-8111-111111111111', '2026-04-29T12:00:00.000Z');
    const result = await ctrl.getBoard(OP);
    expect(result.rows).toHaveLength(1);
    const r = result.rows[0]; if (r === undefined) throw new Error('expected row');
    expect(r.plannedStartAt).toBe('2026-04-29T12:00:00.000Z');
    expect(r.transportOrderRefs).toEqual(['TO-1', 'TO-2']);
  });
  it('serializes null plannedStartAt', async () => {
    await insertProjection('bbbbbbbb-1111-4111-8111-111111111111', null);
    const result = await ctrl.getBoard(OP);
    const r = result.rows[0]; if (r === undefined) throw new Error('expected row');
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
    const r = result.rows[0]; if (r === undefined) throw new Error('expected row');
    expect(r.roadRunId).toBe('cccccccc-1111-4111-8111-111111111111');
  });
  // T10: the board enriches each row with its per-stop status so the Lệnh điều
  // xe table can show Điểm nhận hàng 1..4 / Kho giao hàng 1 columns.
  it('attaches stops with warehouse name and arrival/departure times to the row', async () => {
    const rr = 'eeeeeeee-1111-4111-8111-111111111111';
    await insertProjection(rr, '2026-05-30T08:00:00.000Z');
    await seedStopChain(rr, 'ffffffff-1111-4111-8111-111111111111');
    const result = await ctrl.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === rr);
    if (row === undefined) throw new Error('expected board row');
    expect(row.stops).toBeDefined();
    const s = row.stops.find((x) => x.sequence === 1);
    if (s === undefined) throw new Error('expected stop 1');
    expect(s.warehouseName).toBe('Chơn Chính');
    expect(s.stopType).toBe('pickup');
    expect(s.arrivedAt).toBe('2026-05-30T09:00:00.000Z');
    expect(s.departedAt).toBe('2026-05-30T09:15:00.000Z');
  });
  // KH column (2026): the board must expose the order's customer name so the
  // Lệnh điều xe table can show Khách hàng in place of Trạng thái. Enriched at
  // read time via road_run_transport_order -> transport_order -> customer,
  // scoped by company_id (mirrors the T10 stop-enrichment join).
  it('attaches the customer name to the row (Khách hàng column source)', async () => {
    const rr = 'a1a1a1a1-1111-4111-8111-111111111111';
    await insertProjection(rr, '2026-05-30T08:00:00.000Z');
    await seedStopChain(rr, 'b2b2b2b2-1111-4111-8111-111111111111');
    const result = await ctrl.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === rr);
    if (row === undefined) throw new Error('expected board row');
    expect(row.customerName).toBe('Công ty Vận Tải Số 1');
  });

  // KH phone (2026): permanent business rule — the board must also expose the
  // order customer's Số điện thoại so the Lệnh điều xe table can display it next
  // to Khách hàng. Enriched at read time on the SAME customer join (add
  // customer.phone to the existing customerRows select), scoped by company_id.
  it('attaches the customer phone to the row (Số điện thoại source)', async () => {
    const rr = 'c3c3c3c3-1111-4111-8111-111111111111';
    await insertProjection(rr, '2026-05-30T08:00:00.000Z');
    await seedStopChain(rr, 'd4d4d4d4-1111-4111-8111-111111111111');
    const result = await ctrl.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === rr);
    if (row === undefined) throw new Error('expected board row');
    expect(row.customerPhone).toBe('0901234567');
  });

  // Ten hang (T18): the board must expose the order cargo type name so the
  // Lenh dieu xe table can show a Ten hang column. Enriched at read time via
  // road_run_transport_order -> transport_order -> cargo_type, scoped by
  // company_id (mirrors the customer-name join).
  it('attaches the cargo type name to the row (Ten hang column source)', async () => {
    const rr = 'e5e5e5e5-1111-4111-8111-111111111111';
    await insertProjection(rr, '2026-05-30T08:00:00.000Z');
    await seedStopChain(rr, 'f6f6f6f6-1111-4111-8111-111111111111');
    const result = await ctrl.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === rr);
    if (row === undefined) throw new Error('expected board row');
    expect(row.cargoName).toBe('Gao');
  });

  const RR = 'cccccccc-1111-4111-8111-111111111111';
  const TO = 'cccccccc-2222-4222-8222-222222222222';
  const SID = '22222222-aaaa-4aaa-8aaa-222222222222';
  const MID = '55555555-aaaa-4aaa-8aaa-555555555555';

  it('returns proof {manifestId, photoUrl} for a stop with a committed manifest', async () => {
    await insertProjection(RR, '2026-06-08T08:00:00.000Z');
    await seedStopChain(RR, TO);
    await seedCommittedManifestForStop(TO, SID, MID);
    // Faked proof-URL signer: deterministic, no real S3. The controller must
    // accept this port and call it with the committed manifest's S3 object.
    const PROOF_URL = 'https://s3.example/signed-proof?sig=test';
    const fakeSigner = { presignProofUrl: (_i: { bucket: string; key: string; ttlSeconds: number }) => Promise.resolve(PROOF_URL) };
    const ctrlWithSigner = new DispatchController(testDb.db as never, fakeSigner as never);
    const result = await ctrlWithSigner.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === RR);
    if (!row) throw new Error('expected board row');
    const stopWithProof = row.stops.find((s) => s.sequence === 1);
    if (!stopWithProof) throw new Error('expected stop seq 1');
    // The stop must validate against the shared contract and carry proof.
    const parsed = DispatchStopViewSchema.parse(stopWithProof);
    expect(parsed.proof).not.toBeNull();
    expect(parsed.proof?.manifestId).toBe(MID);
    expect(parsed.proof?.photoUrl).toBe(PROOF_URL);
  });

  it('returns proof === null for a stop with no committed manifest', async () => {
    await insertProjection(RR, '2026-06-08T08:00:00.000Z');
    await seedStopChain(RR, TO);
    const fakeSigner = { presignProofUrl: (_i: { bucket: string; key: string; ttlSeconds: number }) => Promise.resolve('https://s3.example/x') };
    const ctrlWithSigner = new DispatchController(testDb.db as never, fakeSigner as never);
    const result = await ctrlWithSigner.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === RR);
    if (!row) throw new Error('expected board row');
    const s1 = row.stops.find((s) => s.sequence === 1);
    if (!s1) throw new Error('expected stop seq 1');
    expect(DispatchStopViewSchema.parse(s1).proof).toBeNull();
  });

  it('proof carries extractedNetWeightKg once extraction persisted it (phieu-can kg)', async () => {
    await insertProjection(RR, '2026-06-08T08:00:00.000Z');
    await seedStopChain(RR, TO);
    await seedCommittedManifestForStop(TO, SID, MID);
    await testDb.db.execute(sql`UPDATE manifest SET extracted_net_weight_kg = 20730.000 WHERE manifest_id = ${MID}::uuid`);
    const fakeSigner = { presignProofUrl: (_i: { bucket: string; key: string; ttlSeconds: number }) => Promise.resolve('https://s3.example/p') };
    const ctrlWithSigner = new DispatchController(testDb.db as never, fakeSigner as never);
    const result = await ctrlWithSigner.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === RR);
    if (!row) throw new Error('expected board row');
    const s1 = row.stops.find((q) => q.sequence === 1);
    if (!s1) throw new Error('expected stop seq 1');
    const parsed = DispatchStopViewSchema.parse(s1);
    expect(parsed.proof?.extractedNetWeightKg).toBe(20730);
  });

  it('proof.extractedNetWeightKg is null before extraction completes', async () => {
    await insertProjection(RR, '2026-06-08T08:00:00.000Z');
    await seedStopChain(RR, TO);
    await seedCommittedManifestForStop(TO, SID, MID);
    const fakeSigner = { presignProofUrl: (_i: { bucket: string; key: string; ttlSeconds: number }) => Promise.resolve('https://s3.example/p') };
    const ctrlWithSigner = new DispatchController(testDb.db as never, fakeSigner as never);
    const result = await ctrlWithSigner.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === RR);
    if (!row) throw new Error('expected board row');
    const s1 = row.stops.find((q) => q.sequence === 1);
    if (!s1) throw new Error('expected stop seq 1');
    const parsed = DispatchStopViewSchema.parse(s1);
    expect(parsed.proof?.extractedNetWeightKg ?? null).toBeNull();
  });


  it('proof.extractionStatus is "pending" for a freshly committed manifest (gap 2)', async () => {
    await insertProjection(RR, '2026-06-08T08:00:00.000Z');
    await seedStopChain(RR, TO);
    await seedCommittedManifestForStop(TO, SID, MID);
    const fakeSigner = { presignProofUrl: (_i: { bucket: string; key: string; ttlSeconds: number }) => Promise.resolve('https://s3.example/p') };
    const ctrlWithSigner = new DispatchController(testDb.db as never, fakeSigner as never);
    const result = await ctrlWithSigner.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === RR);
    if (!row) throw new Error('expected board row');
    const s1 = row.stops.find((q) => q.sequence === 1);
    if (!s1) throw new Error('expected stop seq 1');
    expect(DispatchStopViewSchema.parse(s1).proof?.extractionStatus).toBe('pending');
  });

  it('proof.extractionStatus reflects a persisted not_found (gap 2: needs-entry vs processing)', async () => {
    await insertProjection(RR, '2026-06-08T08:00:00.000Z');
    await seedStopChain(RR, TO);
    await seedCommittedManifestForStop(TO, SID, MID);
    await testDb.db.execute(sql`UPDATE manifest SET extraction_status = 'not_found' WHERE manifest_id = ${MID}::uuid`);
    const fakeSigner = { presignProofUrl: (_i: { bucket: string; key: string; ttlSeconds: number }) => Promise.resolve('https://s3.example/p') };
    const ctrlWithSigner = new DispatchController(testDb.db as never, fakeSigner as never);
    const result = await ctrlWithSigner.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === RR);
    if (!row) throw new Error('expected board row');
    const s1 = row.stops.find((q) => q.sequence === 1);
    if (!s1) throw new Error('expected stop seq 1');
    expect(DispatchStopViewSchema.parse(s1).proof?.extractionStatus).toBe('not_found');
  });
  it('proof.extractionReason surfaces the persisted failure cause (review queue)', async () => {
    await insertProjection(RR, '2026-06-08T08:00:00.000Z');
    await seedStopChain(RR, TO);
    await seedCommittedManifestForStop(TO, SID, MID);
    await testDb.db.execute(sql`UPDATE manifest SET extraction_status = 'unreadable', extraction_reason = 'unparseable' WHERE manifest_id = ${MID}::uuid`);
    const fakeSigner = { presignProofUrl: (_i: { bucket: string; key: string; ttlSeconds: number }) => Promise.resolve('https://s3.example/p') };
    const ctrlWithSigner = new DispatchController(testDb.db as never, fakeSigner as never);
    const result = await ctrlWithSigner.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === RR);
    if (!row) throw new Error('expected board row');
    const s1 = row.stops.find((q) => q.sequence === 1);
    if (!s1) throw new Error('expected stop seq 1');
    const proof = DispatchStopViewSchema.parse(s1).proof;
    expect(proof?.extractionStatus).toBe('unreadable');
    expect(proof?.extractionReason).toBe('unparseable');
  });
  it('proof.extractionReason is null/absent for a successful extraction', async () => {
    await insertProjection(RR, '2026-06-08T08:00:00.000Z');
    await seedStopChain(RR, TO);
    await seedCommittedManifestForStop(TO, SID, MID);
    await testDb.db.execute(sql`UPDATE manifest SET extraction_status = 'extracted', extracted_net_weight_kg = '20730.000', extraction_reason = NULL WHERE manifest_id = ${MID}::uuid`);
    const fakeSigner = { presignProofUrl: (_i: { bucket: string; key: string; ttlSeconds: number }) => Promise.resolve('https://s3.example/p') };
    const ctrlWithSigner = new DispatchController(testDb.db as never, fakeSigner as never);
    const result = await ctrlWithSigner.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === RR);
    if (!row) throw new Error('expected board row');
    const s1 = row.stops.find((q) => q.sequence === 1);
    if (!s1) throw new Error('expected stop seq 1');
    const proof = DispatchStopViewSchema.parse(s1).proof;
    expect(proof?.extractionStatus).toBe('extracted');
    expect(proof?.extractionReason ?? null).toBeNull();
  });
});

// --- T-proof (2026, outside-in acceptance): per-stop proof-photo "Phiếu Cân" ---
// Outermost behavior: when a stop has a COMMITTED manifest tied to it
// (manifest.stop_id), GET /dispatch/board returns that stop with a non-null
// proof = { manifestId, photoUrl }, where photoUrl is a presigned S3 GET URL.
// Stops without a committed manifest have proof === null. This RED test drives:
// the manifest<->stop join, the DispatchStopView.proof field, and the injected
// proof-URL signer port (faked here for determinism, mirroring the worker S3 fake).
import { DispatchStopViewSchema } from '@fleet/sync-protocol';

// --- Feature 3 (2026): pickup-vs-delivery weight-diff column ---
// weightDiffKg = (sum of pickup stop net weights) - (delivery stop net weight),
// computed server-side, and ONLY when every contributing weight is known (else
// null) so a partial aggregate never misleads the dispatcher reconciliation.
describe('@fleet/api - DispatchController weightDiffKg (Feature 3)', () => {
  const co = OP.companyId;

  async function seedStop(toId: string, stopId: string, seq: number, stopType: string, wid: string): Promise<void> {
    await testDb.db.execute(sql.raw(
      'INSERT INTO warehouse (warehouse_id, company_id, business_unit_id, depot_id, legal_entity_id, name, role) ' +
      'VALUES (' + q(wid) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q('Kho ' + stopId.slice(0, 4)) + ', ' + q(stopType) + ') ON CONFLICT DO NOTHING'
    ));
    await testDb.db.execute(sql.raw(
      'INSERT INTO stop (stop_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type, yard_id, planned_at) ' +
      'VALUES (' + q(stopId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(toId) + ', ' + String(seq) + ', ' + q(stopType) + ', ' + q(wid) + ', ' + q('2026-06-12T08:00:00.000Z') + ')'
    ));
  }

  async function seedWeight(toId: string, stopId: string, manifestId: string, kg: number | null): Promise<void> {
    await seedCommittedManifestForStop(toId, stopId, manifestId);
    if (kg !== null) {
      await testDb.db.execute(sql.raw('UPDATE manifest SET extracted_net_weight_kg = ' + q(kg.toFixed(3)) + ', extraction_status = ' + q('extracted') + ' WHERE manifest_id = ' + q(manifestId) + '::uuid'));
    }
  }

  async function seedRun(rr: string, toId: string, pickups: readonly (number | null)[], delivery: number | null): Promise<void> {
    await insertProjection(rr, '2026-06-12T08:00:00.000Z');
    await testDb.db.execute(sql.raw(
      'INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, external_ref, customer_id, created_at, updated_at) ' +
      'VALUES (' + q(toId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q('XTT.06-777') + ', NULL, now(), now())'
    ));
    await testDb.db.execute(sql.raw(
      'INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id) ' +
      'VALUES (' + q(rr) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q('planned') + ', ' + q(co) + ', ' + q(co) + ')'
    ));
    await testDb.db.execute(sql.raw(
      'INSERT INTO road_run_transport_order (road_run_id, transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, sequence) ' +
      'VALUES (' + q(rr) + ', ' + q(toId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', 1)'
    ));
    let n = 0;
    for (const kg of pickups) {
      n += 1;
      const sid = 'd0000000-aaaa-4aaa-8aaa-00000000000' + String(n);
      const mid = 'e0000000-aaaa-4aaa-8aaa-00000000000' + String(n);
      const wid = 'c0000000-aaaa-4aaa-8aaa-00000000000' + String(n);
      await seedStop(toId, sid, n, 'pickup', wid);
      await seedWeight(toId, sid, mid, kg);
    }
    await seedStop(toId, 'd0000000-aaaa-4aaa-8aaa-0000000000d1', 90, 'delivery', 'c0000000-aaaa-4aaa-8aaa-0000000000d1');
    await seedWeight(toId, 'd0000000-aaaa-4aaa-8aaa-0000000000d1', 'e0000000-aaaa-4aaa-8aaa-0000000000d1', delivery);
  }

  const SIGNER = { presignProofUrl: (_i: { bucket: string; key: string; ttlSeconds: number }) => Promise.resolve('https://s3.example/p') };

  it('computes weightDiffKg = sum(pickups) - delivery when ALL weights are known', async () => {
    const rr = 'f0000000-1111-4111-8111-000000000001';
    await seedRun(rr, 'f0000000-2222-4222-8222-000000000001', [7920, 35080], 50140);
    const ctrlS = new DispatchController(testDb.db as never, SIGNER as never);
    const result = await ctrlS.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === rr);
    if (row === undefined) throw new Error('expected row');
    expect(row.weightDiffKg).toBe(7140);
  });

  it('is null when ANY pickup weight is missing (no misleading partial)', async () => {
    const rr = 'f0000000-1111-4111-8111-000000000002';
    await seedRun(rr, 'f0000000-2222-4222-8222-000000000002', [7920, null], 50140);
    const ctrlS = new DispatchController(testDb.db as never, SIGNER as never);
    const result = await ctrlS.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === rr);
    if (row === undefined) throw new Error('expected row');
    expect(row.weightDiffKg).toBeNull();
  });

  it('is null when the delivery weight is missing', async () => {
    const rr = 'f0000000-1111-4111-8111-000000000003';
    await seedRun(rr, 'f0000000-2222-4222-8222-000000000003', [7920, 35080], null);
    const ctrlS = new DispatchController(testDb.db as never, SIGNER as never);
    const result = await ctrlS.getBoard(OP);
    const row = result.rows.find((r) => r.roadRunId === rr);
    if (row === undefined) throw new Error('expected row');
    expect(row.weightDiffKg).toBeNull();
  });
});

async function seedCommittedManifestForStop(
  transportOrderId: string,
  stopId: string,
  manifestId: string,
): Promise<void> {
  const co = OP.companyId;
  // Derive per-manifest unique IDs so this helper can seed several stops in one
  // test without colliding on these primary keys.
  const suffix = manifestId.slice(-12);
  const corr = '44444444-aaaa-4aaa-8aaa-' + suffix;
  const uploadSessionId = '66666666-aaaa-4aaa-8aaa-' + suffix;
  await testDb.db.execute(sql.raw(
    'INSERT INTO manifest (manifest_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, manifest_correlation_id, stop_id, state, captured_at, committed_at) ' +
    'VALUES (' + q(manifestId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' +
    q(transportOrderId) + ', ' + q(corr) + ', ' + q(stopId) + ', ' + q('committed') + ', now(), now())'
  ));
  // upload_session holds the S3 object key the controller presigns for the proof.
  await testDb.db.execute(sql.raw(
    'INSERT INTO upload_session (upload_session_id, company_id, business_unit_id, depot_id, legal_entity_id, manifest_id, operator_id, s3_key, s3_bucket, content_type, state, committed_at) ' +
    'VALUES (' + q(uploadSessionId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' +
    q(manifestId) + ', ' + q(co) + ', ' + q('manifests/co/' + manifestId + '/photo.jpg') + ', ' + q('fleet-pilot-artifacts') + ', ' + q('image/jpeg') + ', ' + q('committed') + ', now())'
  ));
}
