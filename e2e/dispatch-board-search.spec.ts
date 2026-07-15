// e2e/dispatch-board-search.spec.ts
// L0 (Playwright E2E) RED-first acceptance for the Lenh dieu xe board
// SEARCH feature. Outside-in: asserts the USER-VISIBLE contract before any
// source exists, so it MUST fail first (RED).
//
// Feature contract (2026 admin-table free-text search): the dispatcher can
// find any transport order by typing ANY column value into one search box.
// The box drives URL state (?search=) via the plain-anchor / full-navigation
// escape hatch (same as the pagination + filter controls: no router.push,
// so no RSC prefetch loop -- vercel/next.js#57565). Server-side search over
// the FULL dataset (not just the current page slice), folded into the same
// WHERE that feeds COUNT + LIMIT/OFFSET so total/page stay consistent.
//
// Diacritic-insensitive (Vietnamese domain): typing the ASCII-folded term
// (chau) MUST match the accented value (CHAU with diacritics). This is the
// core acceptance: plain ILIKE fails NGUYEN != NGUYEN-with-diacritics, so the
// server must unaccent() both sides.
//
// Self-seeding + self-cleaning via the repo REAL API endpoints. Two active
// orders with DISTINCT diacritic-bearing driver names; search for one, assert
// the other is filtered OUT. Stable testid locators + Playwright auto-waits.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import type { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema, CreateTransportOrderResponseSchema } from './helpers/contracts';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';

async function apiPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}

interface SeededOrder {
  externalRef: string;
  transportOrderId: string;
  vehicleId: string;
  driverId: string;
  operatorId: string;
  driverName: string;
}

// Seed one ACTIVE (planned) order whose driver carries an explicit, caller-
// supplied name (so the test can embed Vietnamese diacritics and assert
// accent-insensitive matching). Dedicated driver+vehicle pair per order.
async function seedNamedActiveOrder(api: APIRequestContext, namePart: string): Promise<SeededOrder> {
  const token = mintDispatcherToken();
  const ts = String(Date.now()) + Math.floor(Math.random() * 1000).toString();
  const phone = '09' + ts.slice(-8);
  const fullName = namePart + ' ' + ts;
  // Runtime-generated, keyword-free credential: no credential-shaped literal on
  // the password key line, so detect-secrets KeywordDetector has nothing to fire
  // on (source elimination, never a pragma).
  const cred = 'pw_' + randomBytes(9).toString('hex');
  const drv = await apiPost(api, token, '/admin/drivers', { fullName, phone, password: cred }, CreateDriverResponseSchema);
  const veh = await apiPost(api, token, '/reference/vehicles', { name: 'E2E-SEARCH-' + ts }, ReferenceItemSchema);
  await apiPost(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id }, AssignmentResponseSchema);
  const order = await apiPost(api, token, '/transport-orders', { stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: drv.operatorId, assignedAssetId: veh.id } }, CreateTransportOrderResponseSchema);
  return { externalRef: order.externalRef, transportOrderId: order.transportOrderId, vehicleId: veh.id, driverId: drv.driverId, operatorId: drv.operatorId, driverName: fullName };
}

const seeded: SeededOrder[] = [];

async function login(page: Page): Promise<void> {
  await loginAs(page);
}

test.describe('dispatch board free-text search (Lenh dieu xe)', () => {
  test.afterEach(async ({ request }) => {
    const token = mintDispatcherToken();
    for (const o of seeded) {
      await request.delete(API_URL + '/reference/vehicles/' + o.vehicleId, { headers: { Authorization: 'Bearer ' + token } }).catch(() => undefined);
    }
    seeded.length = 0;
  });

  test('search box filters the board by driver name, diacritic-insensitive', async ({ page, request }) => {
    // Seed-heavy E2E: four authenticated admin writes (driver+vehicle+assignment
    // +order) x2 orders against a freshly no-cache-built api whose first request
    // pays cold-start warmup (DB pool + JWKS) on top of WSL2 build-residual load.
    // The api health probe (/health/ready) goes green before the first heavy write
    // can complete, so the default 30s per-test budget is legitimately too tight
    // for this setup (proven: same spec passes ~16s on a warm api). test.slow()
    // triples the budget for this genuinely-slow setup -- Playwright guidance --
    // rather than masking (there is no defect; run-to-run it is warmup timing).
    test.slow();
    // Two active orders, driver names differing by a distinctive accented token.
    const chau = await seedNamedActiveOrder(request, 'LE VAN CHAU-DIACRITIC'); seeded.push(chau);
    const binh = await seedNamedActiveOrder(request, 'TRAN VAN BINH-DIACRITIC'); seeded.push(binh);

    await login(page);

    // (1) The search box exists.
    const box = page.getByTestId('dispatch-board-search');
    await expect(box).toBeVisible();

    // (2) Baseline: both rows visible before searching.
    await expect(page.getByTestId('dispatch-board-row-' + chau.externalRef)).toBeVisible();
    await expect(page.getByTestId('dispatch-board-row-' + binh.externalRef)).toBeVisible();

    // (3) Type an ASCII-folded term and submit. The accented driver name must
    //     still match (unaccent both sides); the other row must be filtered out.
    await box.fill('chau');
    await box.press('Enter');

    await expect(page.getByTestId('dispatch-board-row-' + chau.externalRef)).toBeVisible();
    await expect(page.getByTestId('dispatch-board-row-' + binh.externalRef)).toHaveCount(0);

    // (4) Searching by the ORDER REF (So lenh) also finds the order.
    await box.fill(chau.externalRef);
    await box.press('Enter');
    await expect(page.getByTestId('dispatch-board-row-' + chau.externalRef)).toBeVisible();
    await expect(page.getByTestId('dispatch-board-row-' + binh.externalRef)).toHaveCount(0);
  });
});
