// e2e/dispatch-board-khachhang-phone.spec.ts
// L0 ACCEPTANCE (2026): permanent business rule. In the Lệnh điều xe board,
// the Khách hàng column also displays the customer's Số điện thoại (phone).
//
// Critical user journey: the dispatcher sees the customer's phone number in the
//   Lệnh điều xe board next to the customer name.
// Business invariant: every board row whose order has a customer with a phone
//   renders that Số điện thoại in the board.
//
// Outside-in: this fails first because (a) the API board row carries no
// customerPhone and (b) the board renders no phone. It drives the API read-time
// customer-phone enrichment (L3/L4), the ops-web type + render (L1/L2), and the
// /reference/customers create accepting a phone so the seed can set one.
//
// ISOLATION (2026-07-23 root fix). This spec had NO cleanup: it seeded a
// driver, vehicle, pair and six reference rows, created an order through the
// UI, and left all of it behind -- as did its sibling
// dispatch-board-khachhang-column.spec.ts. Running after that sibling, this
// spec failed against a polluted board; the failure DOM showed exactly ONE row
// carrying the SIBLING's labels while this spec waited for its own. It passes
// when run alone and fails when run after the sibling: order-dependent shared
// state, not a timing race.
//
// Every other board spec already cleans up after itself (see
// dispatch-board-row-navigation.spec.ts cleanupSeeded/cleanupPair). 2026
// practice is explicit: each test operates on its own data set, created per
// test and deleted in an after hook, at a cost of a few hundred milliseconds.
//
// READ-MODEL SETTLE (2026-08-07, a SECOND and distinct cause). Cleanup fixed
// cross-spec pollution, yet this spec kept failing -- reproduced locally on a
// clean isolated stack, red on both the first attempt and the retry with fresh
// seeds each time. The create returns on the WRITE commit while the row still
// travels outbox -> relay -> BullMQ -> projection, and the page holds a render
// taken before it existed: DispatchView shows an optimistic row built from the
// action result (externalRef only, no customerName), and the single
// router.refresh() fires while the projection is still catching up, with no
// second attempt. Asserting a server-derived field therefore raced two async
// hops against a fixed 15s locator budget. settleBoardAfterCreate replaces that
// race with a statement about what must be true first.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { dockerPsql } from './helpers/docker-exec';
import { type z } from 'zod';
import {
  parseJson,
  CreateDriverResponseSchema,
  ReferenceItemSchema,
  AssignmentResponseSchema,
} from './helpers/contracts';
import { openCreateOrderDrawer, plannedStartAtField } from './helpers/create-order';
import { settleBoardAfterCreate } from './helpers/wait-for-projection';
import { ROW_VISIBILITY_BUDGET_MS } from './helpers/budgets';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';

async function pickCombobox(page: Page, inputId: string, optionLabel: string): Promise<void> {
  const input = page.locator('#' + inputId);
  await expect(input).toBeVisible({ timeout: 15_000 });
  await expect(input).toBeEditable({ timeout: 15_000 });
  const opt = page.getByRole('option', { name: optionLabel });
  for (let attempt = 0; attempt < 4; attempt++) {
    await input.fill('');
    await input.fill(optionLabel);
    try {
      await expect(opt).toBeVisible({ timeout: 5_000 });
      break;
    } catch {
      if (attempt === 3) throw new Error('combobox option not visible: ' + optionLabel);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
  }
  await opt.click();
}

async function adminPost<T>(
  api: APIRequestContext,
  token: string,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok())
    throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}

interface Seed {
  token: string;
  driverId: string;
  vehicleId: string;
  assignmentId: string;
  customerId: string;
  cargoTypeId: string;
  pickupId: string;
  deliveryId: string;
  customerName: string;
  customerPhone: string;
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
  const driverPhone =
    '09' +
    String(ts).slice(-6) +
    Math.floor(Math.random() * 100)
      .toString()
      .padStart(2, '0');
  const customerPhone =
    '08' +
    String(ts).slice(-6) +
    Math.floor(Math.random() * 100)
      .toString()
      .padStart(2, '0');
  const driverLabel = 'E2E DRIVER KHP ' + rand;
  const vehicleLabel = 'E2E-KHP-' + rand;
  const customerName = 'E2E-KHACH-' + rand;
  const cargoName = 'E2E-HANG-' + rand;
  const pickupName = 'E2E-PICKUP-' + rand;
  const deliveryName = 'E2E-DELIVERY-' + rand;

  const drv = await adminPost(
    api,
    token,
    '/admin/drivers',
    { fullName: driverLabel, phone: driverPhone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
    CreateDriverResponseSchema,
  );
  const veh = await adminPost(
    api,
    token,
    '/reference/vehicles',
    { name: vehicleLabel },
    ReferenceItemSchema,
  );
  const asgn = await adminPost(
    api,
    token,
    '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
    AssignmentResponseSchema,
  );
  const cust = await adminPost(
    api,
    token,
    '/reference/customers',
    { name: customerName, phone: customerPhone },
    ReferenceItemSchema,
  );
  const cargo = await adminPost(
    api,
    token,
    '/reference/cargo-types',
    { name: cargoName },
    ReferenceItemSchema,
  );
  const pickup = await adminPost(
    api,
    token,
    '/reference/warehouses',
    { name: pickupName, role: 'pickup' },
    ReferenceItemSchema,
  );
  const delivery = await adminPost(
    api,
    token,
    '/reference/warehouses',
    { name: deliveryName, role: 'delivery' },
    ReferenceItemSchema,
  );

  return {
    token,
    driverId: drv.driverId,
    vehicleId: veh.id,
    assignmentId: asgn.assignmentId,
    customerId: cust.id,
    cargoTypeId: cargo.id,
    pickupId: pickup.id,
    deliveryId: delivery.id,
    customerName,
    customerPhone,
    cargoName,
    vehicleLabel,
    driverLabel,
    pickupName,
    deliveryName,
  };
}

// Delete the order family this spec created through the UI, keyed by the
// external_ref the success banner reported. Mirrors cleanupSeeded in
// dispatch-board-row-navigation.spec.ts; every statement tolerates not-found.
function cleanupOrder(externalRef: string): void {
  const sq = String.fromCharCode(39);
  const txId = dockerPsql(
    'SELECT transport_order_id FROM transport_order WHERE company_id=' +
      sq +
      COMPANY_ID +
      sq +
      ' AND external_ref=' +
      sq +
      externalRef +
      sq +
      ';',
  ).stdout.trim();
  if (txId.length > 0) {
    const rrIds = dockerPsql(
      'SELECT road_run_id FROM road_run_transport_order WHERE transport_order_id=' +
        sq +
        txId +
        sq +
        ';',
    )
      .stdout.trim()
      .split(String.fromCharCode(10))
      .filter((line) => line.length > 0);
    try {
      dockerPsql('DELETE FROM stop WHERE transport_order_id=' + sq + txId + sq + ';');
    } catch {
      /* tolerate */
    }
    try {
      dockerPsql(
        'DELETE FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';',
      );
    } catch {
      /* tolerate */
    }
    for (const rrId of rrIds) {
      try {
        dockerPsql(
          'DELETE FROM dispatch_board_projection WHERE road_run_id=' + sq + rrId + sq + ';',
        );
      } catch {
        /* tolerate */
      }
      try {
        dockerPsql('DELETE FROM road_run WHERE road_run_id=' + sq + rrId + sq + ';');
      } catch {
        /* tolerate */
      }
    }
  }
  try {
    dockerPsql(
      'DELETE FROM outbox WHERE company_id=' +
        sq +
        COMPANY_ID +
        sq +
        ' AND payload::text LIKE ' +
        sq +
        '%' +
        externalRef +
        '%' +
        sq +
        ';',
    );
  } catch {
    /* tolerate */
  }
  try {
    dockerPsql(
      'DELETE FROM transport_order WHERE company_id=' +
        sq +
        COMPANY_ID +
        sq +
        ' AND external_ref=' +
        sq +
        externalRef +
        sq +
        ';',
    );
  } catch {
    /* tolerate */
  }
}

// Revoke the pair and remove every reference row this spec seeded, so the next
// spec sees the dropdowns it expects.
async function cleanupSeed(api: APIRequestContext, seed: Seed): Promise<void> {
  const auth = { Authorization: 'Bearer ' + seed.token };
  try {
    await api.delete(API_URL + '/admin/driver-vehicle-assignments/' + seed.assignmentId, {
      headers: { ...auth, 'Content-Type': 'application/json' },
      data: JSON.stringify({ reason: 'e2e-cleanup' }),
    });
  } catch {
    /* tolerate */
  }
  for (const path of [
    '/reference/vehicles/' + seed.vehicleId,
    '/admin/drivers/' + seed.driverId,
    '/reference/customers/' + seed.customerId,
    '/reference/cargo-types/' + seed.cargoTypeId,
    '/reference/warehouses/' + seed.pickupId,
    '/reference/warehouses/' + seed.deliveryId,
  ]) {
    try {
      await api.delete(API_URL + path, { headers: auth });
    } catch {
      /* tolerate */
    }
  }
}

test.describe.serial('Lệnh điều xe board: Khách hàng shows Số điện thoại', () => {
  let seed: Seed | null = null;
  let createdRef = '';

  test.afterAll(async ({ request }) => {
    if (createdRef !== '') cleanupOrder(createdRef);
    if (seed) await cleanupSeed(request, seed);
  });

  test('board displays the customer phone number for the order', async ({ page, request }) => {
    seed = await seedAll(request);

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

    // Capture the server-assigned Số lệnh so afterAll deletes exactly this
    // order, and so a failed create fails loudly here rather than later as a
    // confusing missing-cell assertion.
    const banner = page.getByRole('status').filter({ hasText: /XTT[.]/ });
    await expect(banner).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });
    const bannerText = (await banner.textContent()) ?? '';
    const match = /XTT[.][0-9]+-[0-9]+/.exec(bannerText);
    if (!match) throw new Error('create banner carried no XTT external_ref: ' + bannerText);
    createdRef = match[0];

    // Settle the board against its own endpoint before asserting anything
    // server-derived: the optimistic row carries externalRef only, and the one
    // router.refresh() already fired against a projection that had not caught up.
    await settleBoardAfterCreate(page, request, seed.token, createdRef);

    // INVARIANT 1: the created order's customer name shows in the board
    // (proves the row reconciled, so the phone assertion is meaningful).
    await expect(page.getByRole('cell', { name: seed.customerName })).toBeVisible({
      timeout: ROW_VISIBILITY_BUDGET_MS,
    });

    // INVARIANT 2: the customer's Số điện thoại shows in the board.
    await expect(page.getByText(seed.customerPhone)).toBeVisible({
      timeout: ROW_VISIBILITY_BUDGET_MS,
    });
  });
});
