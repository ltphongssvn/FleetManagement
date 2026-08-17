// e2e/admin-drivers-reset-password.spec.ts
// Feature B (2026 service-desk reset): a dispatcher resets a driver's password
// from /admin/drivers WITHOUT the driver's current password, and the new
// password then authenticates against the API. This is the OWASP/industry
// assisted-reset workflow (distinct from the driver-app self-service change),
// and it is the only way to recover a driver whose current password is unknown.
//
// Outside-in: RED first because /admin/drivers has no 'Đặt lại mật khẩu' control
// and AdminDriversClient has no resetPassword method.
//
// Determinism: defaults target the pilot driver (TÀI XẾ THỬ NGHIỆM 1 /
// 0900000001), whose login password is known-resettable, so the spec is
// self-contained. Override via env to reset a specific driver (e.g. PHONG):
//   E2E_RESET_DRIVER_NAME, E2E_RESET_DRIVER_PHONE, E2E_RESET_NEW_PASSWORD.
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { parseJson, AccessTokenResponseSchema } from './helpers/contracts';
const DRIVER_NAME = process.env['E2E_RESET_DRIVER_NAME'] ?? 'TÀI XẾ THỬ NGHIỆM 1';
const DRIVER_PHONE = process.env['E2E_RESET_DRIVER_PHONE'] ?? '0900000001';
const NEW_PASSWORD = process.env['E2E_RESET_NEW_PASSWORD'] ?? 'driver1pass';
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
// Authenticate via injected session (ops-web uses Authorization Code + PKCE;
// no credential form). The helper mints a stepped-up dispatcher token and
// sets fleet_session, then lands on the board.
async function login(page: Page): Promise<void> {
  await loginAs(page);
}
test('dispatcher resets a driver password from /admin/drivers and the new password authenticates', async ({ page, request }) => {
  await login(page);
  await page.goto('/admin/drivers');
  // Locate the driver's entry by displayed full name. The pilot driver may
  // render as a table row (fully configured) OR a Can xu ly queue entry
  // (missing vehicle/device) -- anchor type-agnostically on the innermost
  // container so the reset control is found in both worlds.
  const row = page.locator('li, tr').filter({ hasText: DRIVER_NAME }).last();
  await expect(row).toBeVisible({ timeout: 15_000 });
  // The reset control prompts for the new password (mirrors the Hủy phân công
  // window.prompt pattern). Pre-answer the dialog with the new password.
  page.on('dialog', (dialog) => { void dialog.accept(NEW_PASSWORD); });
  // Dat lai mat khau lives in the per-row Thao tac overflow menu (E1-drivers
  // consolidation). Non-destructive, so selecting the item fires it directly
  // with no confirm Dialog. The trigger sits inside the row, but Headless-UI
  // renders MenuItems with anchor=bottom end, which portals the panel to the
  // document root -- so the menuitem is queried at PAGE scope, never inside
  // the row locator. The name regex is ANCHORED (^Thao tac cho ) so it cannot
  // also match some other control whose label merely contains the phrase.
  const menuTrigger = row.getByRole('button', { name: /^Thao tác cho / });
  await expect(menuTrigger).toBeVisible({ timeout: 10_000 });
  await menuTrigger.click();
  const resetItem = page.getByRole('menuitem', { name: /Đặt lại mật khẩu/ });
  await expect(resetItem).toBeVisible({ timeout: 10_000 });
  await resetItem.click();
  // Success surfaces as a per-row confirmation the dispatcher can see.
  await expect(row.getByText(/Đã đặt lại mật khẩu/)).toBeVisible({ timeout: 15_000 });
  // Prove the credential actually changed: the new password authenticates.
  const res = await request.post(API_URL + '/auth/login', {
    data: { phone: DRIVER_PHONE, password: NEW_PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  const body = await parseJson(res, AccessTokenResponseSchema);
  expect(typeof body.accessToken).toBe('string');
});
