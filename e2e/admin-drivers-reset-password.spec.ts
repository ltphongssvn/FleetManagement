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
  // Locate the driver's row by their displayed full name.
  const row = page.locator('tr').filter({ hasText: DRIVER_NAME }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  // The reset control prompts for the new password (mirrors the Hủy phân công
  // window.prompt pattern). Pre-answer the dialog with the new password.
  page.on('dialog', (dialog) => { void dialog.accept(NEW_PASSWORD); });
  const resetBtn = row.getByRole('button', { name: /Đặt lại mật khẩu/ });
  await expect(resetBtn).toBeVisible({ timeout: 10_000 });
  await resetBtn.click();
  // Success surfaces as a per-row confirmation the dispatcher can see.
  await expect(row.getByText(/Đã đặt lại mật khẩu/)).toBeVisible({ timeout: 15_000 });
  // Prove the credential actually changed: the new password authenticates.
  const res = await request.post(API_URL + '/auth/login', {
    data: { phone: DRIVER_PHONE, password: NEW_PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { accessToken?: string };
  expect(typeof body.accessToken).toBe('string');
});
