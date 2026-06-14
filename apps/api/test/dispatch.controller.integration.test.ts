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
  await testDb.db.execute(sql.raw(
    'INSERT INTO customer (customer_id, company_id, business_unit_id, depot_id, legal_entity_id, name, phone) ' +
    'VALUES (' + q(cid) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q('Công ty Vận Tải Số 1') + ', ' + q('0901234567') + ')'
  ));
  await testDb.db.execute(sql.raw(
    'INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, external_ref, customer_id, created_at, updated_at) ' +
    'VALUES (' + q(transportOrderId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q('XTT.05-001') + ', ' + q(cid) + ', now(), now())'
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
describe('@fleet/api - DispatchController.getBoard (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    ctrl = new DispatchController(testDb.db as never);
  }, 60_000);
  afterAll(async () => stopPgliteTestDb(testDb));
  beforeEach(async () => {
    await testDb.db.execute(sql.raw('TRUNCATE TABLE dispatch_board_projection CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE stop CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE road_run_transport_order CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE transport_order CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE warehouse CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE customer CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE upload_session CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE manifest CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE road_run CASCADE'));
  });
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

});

// --- T-proof (2026, outside-in acceptance): per-stop proof-photo "Phiếu Cân" ---
// Outermost behavior: when a stop has a COMMITTED manifest tied to it
// (manifest.stop_id), GET /dispatch/board returns that stop with a non-null
// proof = { manifestId, photoUrl }, where photoUrl is a presigned S3 GET URL.
// Stops without a committed manifest have proof === null. This RED test drives:
// the manifest<->stop join, the DispatchStopView.proof field, and the injected
// proof-URL signer port (faked here for determinism, mirroring the worker S3 fake).
import { DispatchStopViewSchema } from '@fleet/sync-protocol';

async function seedCommittedManifestForStop(
  transportOrderId: string,
  stopId: string,
  manifestId: string,
): Promise<void> {
  const co = OP.companyId;
  const corr = '44444444-aaaa-4aaa-8aaa-444444444444';
  await testDb.db.execute(sql.raw(
    'INSERT INTO manifest (manifest_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, manifest_correlation_id, stop_id, state, captured_at, committed_at) ' +
    'VALUES (' + q(manifestId) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' +
    q(transportOrderId) + ', ' + q(corr) + ', ' + q(stopId) + ', ' + q('committed') + ', now(), now())'
  ));
  // upload_session holds the S3 object key the controller presigns for the proof.
  await testDb.db.execute(sql.raw(
    'INSERT INTO upload_session (upload_session_id, company_id, business_unit_id, depot_id, legal_entity_id, manifest_id, operator_id, s3_key, s3_bucket, content_type, state, committed_at) ' +
    'VALUES (' + q('66666666-aaaa-4aaa-8aaa-666666666666') + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' + q(co) + ', ' +
    q(manifestId) + ', ' + q(co) + ', ' + q('manifests/co/' + manifestId + '/photo.jpg') + ', ' + q('fleet-pilot-artifacts') + ', ' + q('image/jpeg') + ', ' + q('committed') + ', now())'
  ));
}
