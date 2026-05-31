// e2e/review-matches-create-form.spec.ts
//
// T7 (2026): permanent business rule.
//   Critical user journey: dispatcher creates a transport order via the
//     'LỆNH ĐIỀU XE - TẢI THÙNG' form, then navigates to the review view.
//   Business invariant: every field the dispatcher entered in the form
//     must be reflected on the review view with the same value (modulo
//     locale-aware display formatting). The review view IS the
//     authoritative read of what was just written.
//
// Outside-in strict TDD. This spec is the L0 acceptance test and MUST go
// RED first against the current review page. Two missing fields are
// expected to fail in the initial run:
//   - Tên hàng / cargo  (not rendered on OrderReview)
//   - Tài xế / driver   (not rendered on OrderReview)
// The protection chain (Layer 1+2 happy path) confirms plate + customer +
// warehouses + plannedStartAt already round-trip via the projection
// enrichment; this spec ratifies the FULL set as a permanent contract.
//
// Layer split:
//   L0 (this spec): full browser journey -> review view assertions.
//   Inner layers (L1 RTL + L2 vitest + L3 API DTO/service) will drill in
//     once L0 is RED, per the multi-worktree outside-in TDD workflow.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerPsql, dockerExecNode } from './helpers/docker-exec';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
function sq39(): string { return String.fromCharCode(39); }
async function mintDispatcherToken(): Promise<string> {
  const script =
    'fetch(' + JSON.stringify('http://mock-oauth2:8080/fleet/token') +
    ',{method:' + JSON.stringify('POST') +
    ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
    ',body:' + JSON.stringify('grant_type=password&username=dispatcher&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret') + '})' +
    '.then(r=>r.json()).then(j=>process.stdout.write(j.access_token))';
  const out = dockerExecNode('fleet-pilot-api-1', script);
  if (out.length === 0 || out.includes('.') === false) throw new Error('Token mint failed: ' + out);
  return out.trim();
}
interface SeededPair {
  driverId: string;
  operatorId: string;
  vehicleId: string;
  vehicleLabel: string;
  driverLabel: string;
  assignmentId: string;
  token: string;
}
interface SeededRefs {
  customerLabel: string;
  customerId: string;
  cargoLabel: string;
  cargoId: string;
  pickupLabel: string;
  pickupId: string;
  deliveryLabel: string;
  deliveryId: string;
}
async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (res.ok() === false) {
    throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  }
  return (await res.json()) as T;
}
async function setupPair(api: APIRequestContext, suffix: string): Promise<SeededPair> {
  const token = await mintDispatcherToken();
  const ts = Date.now();
  const phone = '09' + String(ts).slice(-8);
  const driverLabel = 'E2E DRIVER ' + suffix + ' ' + String(ts);
  const vehicleLabel = 'E2E-' + suffix + '-' + String(ts);
  const drv = await adminPost<{ driverId: string; operatorId: string }>(
    api, token, '/admin/drivers',
    { fullName: driverLabel, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
  );
  const veh = await adminPost<{ id: string; label: string }>(
    api, token, '/reference/vehicles', { name: vehicleLabel },
  );
  const asgn = await adminPost<{ assignmentId: string }>(
    api, token, '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
  );
  return {
    driverId: drv.driverId, operatorId: drv.operatorId,
    vehicleId: veh.id, vehicleLabel, driverLabel,
    assignmentId: asgn.assignmentId, token,
  };
}
async function setupRefs(api: APIRequestContext, token: string, suffix: string): Promise<SeededRefs> {
  const ts = Date.now();
  const customerLabel = 'E2E-CUST-' + suffix + '-' + String(ts);
  const cargoLabel = 'E2E-CARGO-' + suffix + '-' + String(ts);
  const pickupLabel = 'E2E-PICKUP-' + suffix + '-' + String(ts);
  const deliveryLabel = 'E2E-DELIVERY-' + suffix + '-' + String(ts);
  const c = await adminPost<{ id: string }>(api, token, '/reference/customers', { name: customerLabel });
  const cg = await adminPost<{ id: string }>(api, token, '/reference/cargo-types', { name: cargoLabel });
  const p = await adminPost<{ id: string }>(api, token, '/reference/warehouses', { name: pickupLabel, role: 'pickup' });
  const d = await adminPost<{ id: string }>(api, token, '/reference/warehouses', { name: deliveryLabel, role: 'delivery' });
  return {
    customerLabel, customerId: c.id,
    cargoLabel, cargoId: cg.id,
    pickupLabel, pickupId: p.id,
    deliveryLabel, deliveryId: d.id,
  };
}
async function loginAsDispatcher(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill('dispatcher');
  await page.getByLabel(/mật khẩu|password/i).fill('any-password');
  await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/login') === false);
}
async function pickCombobox(page: Page, inputId: string, optionLabel: string): Promise<void> {
  // Hardening (testing-tdd.md): under serial multi-spec load the optimistic
  // re-render churn can momentarily leave the form intercepting pointer
  // events, so a bare click races the listbox open and burns the whole
  // timeout. Wait for the input to be editable, then drive open-and-select
  // through fill (which focuses + types without a pointer click that the
  // form overlay can swallow), retrying the open deterministically.
  const input = page.locator('input#' + inputId);
  await expect(input).toBeVisible({ timeout: 15000 });
  await expect(input).toBeEditable({ timeout: 15000 });
  const opt = page.getByRole('option', { name: optionLabel });
  for (let attempt = 0; attempt < 4; attempt++) {
    await input.fill('');
    await input.fill(optionLabel);
    try {
      await expect(opt).toBeVisible({ timeout: 5000 });
      break;
    } catch {
      if (attempt === 3) throw new Error('combobox ' + inputId + ' never opened option: ' + optionLabel);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
  }
  await opt.click();
}
test.describe.configure({ mode: 'serial' });
test.describe('review view reflects create-order form (T7)', () => {
  const seededOrderRefs: string[] = [];
  const seededRefNames: string[] = [];
  test('every form field shows on the review view with the same value', async ({ page, request }) => {
    test.setTimeout(120000);
    const pair = await setupPair(request, 'T7');
    const refs = await setupRefs(request, pair.token, 'T7');
    seededRefNames.push(refs.customerLabel, refs.cargoLabel, refs.pickupLabel, refs.deliveryLabel);
    await loginAsDispatcher(page);
    await page.goto('/');
    // Wait for the form to fully hydrate before touching inputs. Without
    // this, the first fill races React hydration and the value is dropped
    // silently — the dispatcher sees an empty Ngày điều xe and the native
    // HTML5 validation blocks submission with no server-action signal.
    await expect(page.getByRole('heading', { name: 'Lệnh điều xe - Tải thùng' })).toBeVisible({ timeout: 15000 });
    // Wait for the hydration-ready signal before touching any input. The
    // heading is server-rendered and visible BEFORE React hydrates; filling
    // an input in that window silently drops the value (Playwright docs /
    // Microsoft #27759). data-hydrated flips to 'true' only in the form's
    // mount effect, i.e. once interactivity is real.
    await expect(page.locator('[data-testid=create-order-form][data-hydrated=true]')).toBeVisible({ timeout: 15000 });
    // Section 1: planned start (ngày điều xe)
    const plannedStart = page.locator('#plannedStartAt');
    await plannedStart.fill('2026-06-02T08:00');
    await expect(plannedStart).toHaveValue('2026-06-02T08:00', { timeout: 5000 });
    // Section 2: khách hàng + tên hàng
    await pickCombobox(page, 'customer', refs.customerLabel);
    await pickCombobox(page, 'cargo', refs.cargoLabel);
    // Section 3: số xe (auto-selects driver via pairing)
    await pickCombobox(page, 'vehiclePlate', pair.vehicleLabel);
    // Section 4: ngày nhận + kho nhận hàng 1
    await page.locator('#pickupAt').fill('2026-06-02T09:00');
    await pickCombobox(page, 'pickupWarehouse_1', refs.pickupLabel);
    // Section 5: ngày giao + kho giao hàng 1
    await page.locator('#deliveryAt').fill('2026-06-02T18:00');
    await pickCombobox(page, 'deliveryWarehouse_1', refs.deliveryLabel);
    await page.getByRole('button', { name: 'Tạo lệnh' }).click();
    await expect(page.getByText(/Số Lệnh:[ ]*XTT[.]/i)).toBeVisible({ timeout: 20000 });
    // Capture the assigned ref so we can navigate AND clean up.
    const sq = sq39();
    const findSql =
      'SELECT external_ref FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' ' +
      'AND external_ref ~ ' + sq + '^XTT[.](0[1-9]|1[0-2])-[0-9]+$' + sq + ' ' +
      'ORDER BY created_at DESC LIMIT 1;';
    let createdRef = '';
    for (let i = 0; i < 40; i++) {
      const r = dockerPsql(findSql);
      if (r.failed) throw new Error('poll psql failed: ' + r.stderr);
      const v = r.stdout.trim();
      if (v.length > 0) { createdRef = v; break; }
      await page.waitForTimeout(500);
    }
    if (createdRef.length > 0) seededOrderRefs.push(createdRef);
    expect(createdRef).toMatch(/^XTT[.](0[1-9]|1[0-2])-[0-9]{3,}$/);
    // Navigate to the review view.
    await page.goto('/dispatch/orders/' + createdRef);
    await expect(page.getByRole('heading', { name: 'Chi tiết đơn vận chuyển' })).toBeVisible();
    // Invariant assertions: every form-captured value reflected on review.
    await expect(page.getByTestId('order-review-external-ref')).toHaveText(createdRef);
    await expect(page.getByTestId('order-review-plate')).toHaveText(pair.vehicleLabel);
    await expect(page.getByTestId('order-review-customer')).toHaveText(refs.customerLabel);
    // T8: single pickup/delivery fields removed; stops carry the slot labels.
    await expect(page.getByTestId('order-review-cargo')).toHaveText(refs.cargoLabel);
    await expect(page.getByTestId('order-review-driver')).toHaveText(pair.driverLabel);
    // T8: review shows Ngày tạo lệnh (createdAt), not Bắt đầu dự kiến.
    await expect(page.getByText('Ngày tạo lệnh')).toBeVisible();
    const createdText = await page.getByTestId('order-review-created-at').innerText();
    expect(createdText).not.toBe('—');
    expect(createdText).toMatch(/2026/);
    // State is planned right after create.
    await expect(page.getByTestId('order-review-state')).toHaveText('planned');
    // T8: stops use the form's fixed slot labels, never raw stopType.
    await expect(page.getByText('Điểm nhận hàng 1')).toBeVisible();
    await expect(page.getByTestId('order-review-stops')).not.toContainText('pickup');
    await expect(page.getByTestId('order-review-stops')).not.toContainText('delivery');
    await expect(page.getByText('Kho giao hàng 1')).toBeVisible();
    // T9: each stop shows its warehouse name (matching the form selection).
    await expect(page.getByTestId('order-review-stops')).toContainText(refs.pickupLabel);
    await expect(page.getByTestId('order-review-stops')).toContainText(refs.deliveryLabel);
    // T9: a freshly-created order has no arrivals; every stop is not-yet-done.
    const firstStop = page.getByTestId('order-review-stop').first();
    await expect(firstStop.getByTestId('order-review-stop-status')).toHaveText('Chưa tới');
    // No-UUID-leak invariant: the review view must surface human-readable
    // labels, never opaque UUIDs. The ONLY allowed UUID is the explicit
    // Mã đơn (ID) field. Every other display field must not match a UUID.
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const tid of ['order-review-external-ref','order-review-plate','order-review-customer','order-review-cargo','order-review-driver','order-review-state','order-review-created-at']) {
      const txt = await page.getByTestId(tid).innerText();
      expect(uuidRe.test(txt), tid + ' must not display a UUID: ' + txt).toBe(false);
    }
  });
  test.afterAll(async () => {
    test.setTimeout(60000);
    const sq = sq39();
    for (const ref of seededOrderRefs) {
      const txIdSql = 'SELECT transport_order_id FROM transport_order WHERE company_id=' +
        sq + COMPANY_ID + sq + ' AND external_ref=' + sq + ref + sq + ';';
      const txId = dockerPsql(txIdSql).stdout.trim();
      if (txId.length > 0) {
        const rrIdSql = 'SELECT road_run_id FROM road_run_transport_order WHERE transport_order_id=' +
          sq + txId + sq + ';';
        const rrIds = dockerPsql(rrIdSql).stdout.trim().split(String.fromCharCode(10)).filter((l) => l.length > 0);
        try { dockerPsql('DELETE FROM stop WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
        try { dockerPsql('DELETE FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
        for (const rrId of rrIds) {
          try { dockerPsql('DELETE FROM road_run WHERE road_run_id=' + sq + rrId + sq + ';'); } catch { /* tolerate */ }
        }
      }
      try { dockerPsql('DELETE FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq +
        ' AND external_ref=' + sq + ref + sq + ';'); } catch { /* tolerate */ }
      try { dockerPsql('DELETE FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
        ' AND external_ref=' + sq + ref + sq + ';'); } catch { /* tolerate */ }
    }
    // Soft-delete the reference rows this spec seeded so they never leak
    // into the live dispatcher form dropdowns (Khach hang, Ten hang, Diem
    // nhan/giao hang). The global teardown is the defense-in-depth backstop;
    // per-spec cleanup keeps the DB clean even between specs in a run.
    for (const name of seededRefNames) {
      try { dockerPsql('UPDATE customer SET active=false WHERE company_id=' + sq + COMPANY_ID + sq + ' AND name=' + sq + name + sq + ';'); } catch { /* tolerate */ }
      try { dockerPsql('UPDATE cargo_type SET active=false WHERE company_id=' + sq + COMPANY_ID + sq + ' AND name=' + sq + name + sq + ';'); } catch { /* tolerate */ }
      try { dockerPsql('UPDATE warehouse SET active=false WHERE company_id=' + sq + COMPANY_ID + sq + ' AND name=' + sq + name + sq + ';'); } catch { /* tolerate */ }
    }
  });
});
