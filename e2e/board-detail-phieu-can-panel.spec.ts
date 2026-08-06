// e2e/board-detail-phieu-can-panel.spec.ts
// T59 acceptance (RED first): the dispatcher compares the Lenh dieu xe board,
// the order detail, and the Phieu Can photo on ONE screen.
//
// Root cause this spec pins down: today the So lenh cell is a plain <a> that
// full-page-navigates to /dispatch/orders/:ref (window 2), and the board Phieu
// Can cell is an <a target=_blank> to a presigned S3 URL (window 3). Three
// windows, constant switching. The contract asserted here is that ONE screen
// holds all three, that NO new browser tab/window is ever opened, and that the
// open panel is URL-addressable so it survives reload and can be shared.
//
// Seeding: this spec seeds its own driver + vehicle + assignment + order with a
// pickup AND a delivery stop, then seeds a COMMITTED manifest + upload_session
// against the delivery stop so the API mints a real presigned proof.photoUrl
// (StopProofUrlSigner is unconditionally provided by DispatchModule, and the
// e2e stack runs LocalStack S3). Tenancy columns are copied from the stop row
// via INSERT..SELECT so this never hardcodes business_unit/depot/legal_entity.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerPsql } from './helpers/docker-exec';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema, CreateTransportOrderResponseSchema } from './helpers/contracts';
import { waitForBoardReady } from './helpers/create-order';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const SQ = String.fromCharCode(39);
const NL = String.fromCharCode(10);
// Net weight seeded on the committed manifest. vi-VN grouping renders 7480 as
// 7.480, which is what the dispatcher reads next to the photo.
const SEEDED_NET_WEIGHT_KG = 7480;
const SEEDED_NET_WEIGHT_VI = '7.480';

interface Seeded {
  driverId: string;
  operatorId: string;
  vehicleId: string;
  assignmentId: string;
  transportOrderId: string;
  externalRef: string;
  token: string;
}

async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}

async function seedOrder(api: APIRequestContext): Promise<Seeded> {
  const token = mintDispatcherToken();
  const ts = Date.now();
  const phone = '09' + String(ts).slice(-8);
  const drv = await adminPost(
    api, token, '/admin/drivers',
    { fullName: 'E2E DRIVER T59-PANEL ' + String(ts), phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
    CreateDriverResponseSchema,
  );
  const veh = await adminPost(api, token, '/reference/vehicles', { name: 'E2E-T59-PANEL-' + String(ts) }, ReferenceItemSchema);
  const asgn = await adminPost(
    api, token, '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
    AssignmentResponseSchema,
  );
  const order = await adminPost(
    api, token, '/transport-orders',
    {
      stops: [
        { sequence: 1, stopType: 'pickup' },
        { sequence: 2, stopType: 'delivery' },
      ],
      roadRun: { assignedOperatorId: drv.operatorId, assignedAssetId: veh.id },
    },
    CreateTransportOrderResponseSchema,
  );
  return {
    driverId: drv.driverId,
    operatorId: drv.operatorId,
    vehicleId: veh.id,
    assignmentId: asgn.assignmentId,
    transportOrderId: order.transportOrderId,
    externalRef: order.externalRef,
    token,
  };
}

// Seed a COMMITTED manifest + its upload_session against the DELIVERY stop, so
// DispatchController.enrichRows resolves a proof and presigns a photo URL.
// upload_session.state is left at its column DEFAULT (the join does not filter
// on it), which avoids hardcoding a value of the upload_session_state enum.
function seedCommittedProof(seeded: Seeded, ts: number): void {
  const txId = seeded.transportOrderId;
  const insertManifest = [
    'INSERT INTO manifest (company_id, business_unit_id, depot_id, legal_entity_id,',
    ' transport_order_id, manifest_correlation_id, stop_id, state, captured_at,',
    ' committed_at, extracted_net_weight_kg, extraction_status)',
    ' SELECT s.company_id, s.business_unit_id, s.depot_id, s.legal_entity_id,',
    ' s.transport_order_id, gen_random_uuid(), s.stop_id, ' + SQ + 'committed' + SQ + ', now(),',
    ' now(), ' + String(SEEDED_NET_WEIGHT_KG) + ', ' + SQ + 'extracted' + SQ,
    ' FROM stop s WHERE s.transport_order_id=' + SQ + txId + SQ,
    ' AND s.stop_type=' + SQ + 'delivery' + SQ + ' LIMIT 1 RETURNING manifest_id;',
  ].join('');
  const manifestId = dockerPsql(insertManifest).stdout.trim().split(NL).filter((l) => l.length > 0)[0];
  if (manifestId === undefined || manifestId === '') {
    throw new Error('seedCommittedProof: no manifest row returned (delivery stop missing?)');
  }
  const insertUpload = [
    'INSERT INTO upload_session (company_id, business_unit_id, depot_id, legal_entity_id,',
    ' manifest_id, operator_id, s3_key, s3_bucket, content_type, committed_at)',
    ' SELECT m.company_id, m.business_unit_id, m.depot_id, m.legal_entity_id,',
    ' m.manifest_id, ' + SQ + seeded.operatorId + SQ + ',',
    ' ' + SQ + 'e2e/t59-phieu-can-' + String(ts) + '.jpg' + SQ + ',',
    ' ' + SQ + 'fleet-manifests' + SQ + ', ' + SQ + 'image/jpeg' + SQ + ', now()',
    ' FROM manifest m WHERE m.manifest_id=' + SQ + manifestId + SQ + ';',
  ].join('');
  dockerPsql(insertUpload);
}

function cleanupSeeded(seeded: Seeded): void {
  const txId = seeded.transportOrderId;
  const rrIds = dockerPsql('SELECT road_run_id FROM road_run_transport_order WHERE transport_order_id=' + SQ + txId + SQ + ';')
    .stdout.trim().split(NL).filter((line) => line.length > 0);
  try { dockerPsql('DELETE FROM upload_session WHERE manifest_id IN (SELECT manifest_id FROM manifest WHERE transport_order_id=' + SQ + txId + SQ + ');'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM manifest WHERE transport_order_id=' + SQ + txId + SQ + ';'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM stop WHERE transport_order_id=' + SQ + txId + SQ + ';'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM road_run_transport_order WHERE transport_order_id=' + SQ + txId + SQ + ';'); } catch { /* tolerate */ }
  for (const rrId of rrIds) {
    try { dockerPsql('DELETE FROM road_run WHERE road_run_id=' + SQ + rrId + SQ + ';'); } catch { /* tolerate */ }
  }
  try { dockerPsql('DELETE FROM outbox WHERE company_id=' + SQ + COMPANY_ID + SQ + ' AND payload->>' + SQ + 'externalRef' + SQ + '=' + SQ + seeded.externalRef + SQ + ';'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM dispatch_board_projection WHERE company_id=' + SQ + COMPANY_ID + SQ + ' AND transport_order_refs @> ' + SQ + '["' + seeded.externalRef + '"]' + SQ + '::jsonb;'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM transport_order WHERE company_id=' + SQ + COMPANY_ID + SQ + ' AND external_ref=' + SQ + seeded.externalRef + SQ + ';'); } catch { /* tolerate */ }
}

async function cleanupPair(api: APIRequestContext, seeded: Seeded): Promise<void> {
  try {
    await api.delete(API_URL + '/admin/driver-vehicle-assignments/' + seeded.assignmentId, {
      headers: { Authorization: 'Bearer ' + seeded.token, 'Content-Type': 'application/json' },
      data: JSON.stringify({ reason: 'e2e-cleanup' }),
    });
  } catch { /* tolerate */ }
  try { await api.delete(API_URL + '/reference/vehicles/' + seeded.vehicleId, { headers: { Authorization: 'Bearer ' + seeded.token } }); } catch { /* tolerate */ }
  try { await api.delete(API_URL + '/admin/drivers/' + seeded.driverId, { headers: { Authorization: 'Bearer ' + seeded.token } }); } catch { /* tolerate */ }
}

async function openBoard(page: Page): Promise<void> {
  await loginAs(page);
  await page.goto('/');
  await waitForBoardReady(page);
}

test.describe.serial('board + detail + phieu can on one screen (T59)', () => {
  let seeded: Seeded | null = null;

  test.beforeAll(async ({ request }) => {
    const ts = Date.now();
    seeded = await seedOrder(request);
    for (let i = 0; i < 30; i++) {
      const r = dockerPsql('SELECT 1 FROM dispatch_board_projection WHERE company_id=' + SQ + COMPANY_ID + SQ + ' AND transport_order_refs @> ' + SQ + '["' + seeded.externalRef + '"]' + SQ + '::jsonb LIMIT 1;');
      if (r.stdout.trim() === '1') break;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    seedCommittedProof(seeded, ts);
  });

  test.afterAll(async ({ request }) => {
    if (!seeded) return;
    cleanupSeeded(seeded);
    await cleanupPair(request, seeded);
  });

  test('opening an order keeps the board visible and shows detail in the same screen', async ({ page }) => {
    if (!seeded) throw new Error('seeded order missing');
    await openBoard(page);
    const rowLink = page.getByTestId('dispatch-board-row-' + seeded.externalRef).first();
    await expect(rowLink).toBeVisible({ timeout: 10000 });
    await rowLink.click();
    const panel = page.getByTestId('order-detail-panel');
    await expect(panel, 'detail panel must open in-place').toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('dispatch-board'), 'board must REMAIN visible beside the panel').toBeVisible();
    await expect(panel.getByTestId('order-review-external-ref')).toHaveText(seeded.externalRef);
  });

  test('the phieu can photo renders inside the same panel, not a separate window', async ({ page }) => {
    if (!seeded) throw new Error('seeded order missing');
    const opened: Page[] = [];
    page.context().on('page', (p) => { opened.push(p); });
    await openBoard(page);
    await page.getByTestId('dispatch-board-row-' + seeded.externalRef).first().click();
    const panel = page.getByTestId('order-detail-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    const photo = panel.getByTestId('order-detail-panel-phieu-can');
    await expect(photo, 'phieu can photo must render INSIDE the panel').toBeVisible({ timeout: 10000 });
    const src = await photo.getAttribute('src');
    expect(src === null ? '' : src, 'photo must use the server-minted presigned URL').toContain('X-Amz-Signature');
    await expect(panel).toContainText(SEEDED_NET_WEIGHT_VI);
    expect(opened, 'no new tab or window may be opened').toHaveLength(0);
  });

  test('no anchor on the board opens a new browser window', async ({ page }) => {
    if (!seeded) throw new Error('seeded order missing');
    await openBoard(page);
    const blankTargets = await page.locator('a[target="_blank"]').count();
    expect(blankTargets, 'board must not spawn windows via target=_blank').toBe(0);
  });

  test('the open panel is URL-addressable and survives a reload', async ({ page }) => {
    if (!seeded) throw new Error('seeded order missing');
    await openBoard(page);
    await page.getByTestId('dispatch-board-row-' + seeded.externalRef).first().click();
    await expect(page.getByTestId('order-detail-panel')).toBeVisible({ timeout: 10000 });
    const url = page.url();
    expect(url, 'panel state must live in the URL').toContain(seeded.externalRef);
    await page.reload();
    await expect(page.getByTestId('order-detail-panel'), 'panel must reopen from the URL').toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('dispatch-board')).toBeVisible();
  });
});
