// e2e/dispatch-board-driver-vehicle-display.spec.ts
// L0 ACCEPTANCE (2026): permanent business rule. In the Lệnh điều xe board the
// Tài xế (driver) and Xe (vehicle) columns must DISPLAY the assigned driver's
// full name and the assigned vehicle's plate — never an em-dash when a paired
// driver+vehicle exists, and never a raw UUID.
//
// Critical user journey: the dispatcher sees Tài xế and Xe populated in the board.
// Business invariant: each board row shows driver.full_name under Tài xế and
//   vehicle.plate under Xe for the road run's assigned operator/asset.
//
// Outside-in: this fails first because the API board row (DispatchBoardRow)
// carries only assignedOperatorId/assignedAssetId (UUIDs), not driverName or
// vehiclePlate, so ops-web renders em-dash. It drives the API read-time
// driver+vehicle enrichment (L3) and the ops-web column render (L1/L2).
//
// EVERY ASSERTION IS SCOPED TO data-testid=dispatch-board. The page now also
// renders the dispatched-vs-idle roster panel above the board, which has its
// own Tài xế / Số xe columns, so page-wide role locators resolve to three
// columnheaders and would resolve the plate cell twice. Scoping is the fix
// Playwright itself prescribes: .first()/.nth() are explicitly NOT recommended
// because they silently pass when the page changes - here a .first() would keep
// this spec green even if the BOARD's own Tài xế column disappeared, destroying
// the exact invariant the spec exists to guard.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { type z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema } from './helpers/contracts';
import { openCreateOrderDrawer, plannedStartAtField } from './helpers/create-order';
import { settleBoardAfterCreate } from './helpers/wait-for-projection';
import { ROW_VISIBILITY_BUDGET_MS } from './helpers/budgets';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';

async function pickCombobox(page: Page, inputId: string, optionLabel: string): Promise<void> {
  const input = page.locator('#' + inputId);
  await expect(input).toBeVisible({ timeout: 15_000 });
  await expect(input).toBeEditable({ timeout: 15_000 });
  const opt = page.getByRole('option', { name: optionLabel });
  for (let attempt = 0; attempt < 4; attempt++) {
    await input.fill('');
    await input.fill(optionLabel);
    try { await expect(opt).toBeVisible({ timeout: 5_000 }); break; }
    catch { if (attempt === 3) throw new Error('combobox option not visible: ' + optionLabel); await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
  }
  await opt.click();
}

async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}

interface Seed {
  token: string;
  customerName: string;
  cargoName: string;
  vehicleLabel: string;
  driverLabel: string;
  pickupName: string;
  deliveryName: string;
}

async function seedAll(api: APIRequestContext): Promise<Seed> {
  const token = mintDispatcherToken();
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  const phone = '09' + String(ts).slice(-6) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
  const driverLabel = 'E2E DRIVER DV ' + rand;
  const vehicleLabel = 'E2E-DV-' + rand;
  const customerName = 'E2E-KHACH-DV-' + rand;
  const cargoName = 'E2E-HANG-DV-' + rand;
  const pickupName = 'E2E-PICKUP-DV-' + rand;
  const deliveryName = 'E2E-DELIVERY-DV-' + rand;

  const drv = await adminPost(
    api, token, '/admin/drivers',
    { fullName: driverLabel, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
    CreateDriverResponseSchema,
  );
  const veh = await adminPost(api, token, '/reference/vehicles', { name: vehicleLabel }, ReferenceItemSchema);
  await adminPost(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id }, AssignmentResponseSchema);
  await adminPost(api, token, '/reference/customers', { name: customerName }, ReferenceItemSchema);
  await adminPost(api, token, '/reference/cargo-types', { name: cargoName }, ReferenceItemSchema);
  await adminPost(api, token, '/reference/warehouses', { name: pickupName, role: 'pickup' }, ReferenceItemSchema);
  await adminPost(api, token, '/reference/warehouses', { name: deliveryName, role: 'delivery' }, ReferenceItemSchema);

  return { token, customerName, cargoName, vehicleLabel, driverLabel, pickupName, deliveryName };
}

test.describe.serial('Lệnh điều xe board: Tài xế + Xe display driver name and plate', () => {
  test('board row shows assigned driver full name under Tài xế and vehicle plate under Xe', async ({ page, request }) => {
    const seed = await seedAll(request);

    // Authenticate via injected session (PKCE login has no credential form).
    await loginAs(page);

    await openCreateOrderDrawer(page);

    const localIso = '2026-06-02';
    await plannedStartAtField(page.locator('[data-testid=nl-create-order-form]')).fill(localIso);
    await pickCombobox(page, 'customer', seed.customerName);
    await pickCombobox(page, 'cargo', seed.cargoName);
    await pickCombobox(page, 'vehiclePlate', seed.vehicleLabel);
    await page.locator('#pickupAt').fill(localIso);
    await pickCombobox(page, 'pickupWarehouse_1', seed.pickupName);
    await page.locator('#deliveryAt').fill(localIso);
    await pickCombobox(page, 'deliveryWarehouse_1', seed.deliveryName);
    await page.getByRole('button', { name: 'Tạo lệnh' }).click();

    // Capture the server-assigned Số lệnh so the settle below has a ref to poll
    // for, and so a failed create fails loudly HERE rather than later as a
    // confusing missing-cell assertion.
    const banner = page.getByRole('status').filter({ hasText: /XTT[.]/ });
    await expect(banner).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });
    const bannerText = (await banner.textContent()) ?? '';
    const match = /XTT[.][0-9]+-[0-9]+/.exec(bannerText);
    if (!match) throw new Error('create banner carried no XTT external_ref: ' + bannerText);
    const createdRef = match[0];

    // READ-MODEL SETTLE (2026-08-09). This spec waited for seed.customerName --
    // a SERVER-DERIVED field -- against a bare 15s locator budget, then
    // reloaded. That could only pass by winning a race it had no way to win
    // reliably: the optimistic row DispatchView renders is built from the action
    // RESULT and carries externalRef ONLY, so it can never satisfy a
    // customerName assertion, and the single router.refresh() fires while the
    // create is still travelling outbox -> relay -> BullMQ -> projection.
    //
    // Auto-waiting cannot rescue this, and that is the general lesson: it
    // handles DOM readiness, not system correctness. The DOM here is present,
    // hydrated and settled -- it simply lacks the row. Padding the timeout is
    // the documented anti-pattern; the structural fix is to wait on the backend
    // fact rather than on the pixels.
    //
    // settleBoardAfterCreate polls GET /dispatch/board (expect.poll, the 2026
    // pattern for eventually-consistent state) until it carries this ref, then
    // reloads -- so the reload is deterministic instead of another roll of the
    // dice, and it subsumes the explicit page.reload() that used to sit here.
    // PR #514 introduced the helper and logged THIS call site as an unconverted
    // caller; this is that conversion.
    await settleBoardAfterCreate(page, request, seed.token, createdRef);

    // The board container. Every assertion below is scoped to it so the roster
    // split panel (which legitimately repeats Tài xế / Số xe headings and plate
    // cells for the whole roster) can never satisfy or ambiguate a board claim.
    const board = page.getByTestId('dispatch-board');

    // The board is now the SERVER-rendered one: the optimistic row (which
    // carried the just-picked labels) is gone after the settle's reload, so
    // these assertions exercise the real API board enrichment.
    await expect(
      board.getByRole('cell', { name: seed.customerName }),
    ).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });
    await expect(board.getByRole('columnheader', { name: 'Tài xế' })).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });

    // INVARIANT 1: the assigned driver full name shows under Tài xế in the
    // server-rendered board. Fails today: the board resolves the driver UUID
    // via the pair-filtered client reference lookup, which no longer contains
    // the now-busy driver, so the cell renders em-dash.
    await expect(
      board.getByRole('cell', { name: seed.driverLabel }),
    ).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });

    // INVARIANT 2: the assigned vehicle plate shows under Xe in the
    // server-rendered board (same root cause as INVARIANT 1). Scoping matters
    // most here: the idle roster table renders this same plate in a td, so an
    // unscoped cell locator would match twice.
    await expect(
      board.getByRole('cell', { name: seed.vehicleLabel }),
    ).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });
  });
});
