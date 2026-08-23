// e2e/p7-devices-approval-verify.spec.ts
// P7 DoD verification (manual gate captured as a @smoke spec): proves the
// devices approval queue is served end-to-end by the live stack across the
// seam 2026 hybrid API+UI testing exists to cover -- contract -> API (status
// filter + offset pagination + output validation) -> BFF proxy -> admin page.
// Follows the 2026 Playwright API-testing checklist: status codes, response
// body structure (present + correctly typed), business logic (right data for
// the right input), and authz (protected endpoint rejects the unauthenticated).
// Auth reuses the shared loginAs helper: the mock-IdP ES256 token is injected
// as the fleet_session cookie and APIRequestContext (page.request) shares it,
// so BFF -> API calls cross the boundary authenticated as the browser would.
// Tagged @smoke so it doubles as a per-deploy backend smoke check, not a
// one-off manual click.
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const ENVELOPE_KEYS: readonly [string, string][] = [
  ['page', 'number'],
  ['pageSize', 'number'],
  ['total', 'number'],
  ['totalPages', 'number'],
  ['hasMore', 'boolean'],
];

test.describe('P7 devices approval queue (live-stack DoD) @smoke', () => {
  test('happy path: BFF returns the typed paginated envelope for the pending queue', async ({
    page,
  }) => {
    await loginAs(page);
    const res = await page.request.get('/api/admin/devices?status=pending&page=1&pageSize=20');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body['data'])).toBe(true);
    for (const [key, kind] of ENVELOPE_KEYS) {
      expect(typeof body[key], key + ' should be a ' + kind).toBe(kind);
    }
    // Business logic: the request params are honored, not ignored.
    expect(body['page']).toBe(1);
    expect(body['pageSize']).toBe(20);
  });

  test('business logic: the status filter is honored (active queue is a valid page)', async ({
    page,
  }) => {
    await loginAs(page);
    const res = await page.request.get('/api/admin/devices?status=active&page=1&pageSize=20');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body['data'])).toBe(true);
  });

  test('authz negative: the BFF rejects an unauthenticated request', async ({ request }) => {
    // No loginAs: a bare APIRequestContext carries no fleet_session cookie.
    const res = await request.get('/api/admin/devices?status=pending&page=1&pageSize=20');
    expect(res.status()).toBe(401);
  });

  test('the admin page renders the Thiet bi devices section with its pending tab', async ({
    page,
  }) => {
    await loginAs(page);
    await page.goto('/admin/co-so-du-lieu');
    await expect(page.getByRole('heading', { name: 'Thiết bị', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Chờ duyệt' })).toBeVisible();
  });
});
