// e2e/t5-remove-redundant-ui.spec.ts
// T5 acceptance (outside-in RED): redundant UI elements must not appear in
// the dispatcher experience. This spec is the outermost gate of the
// outside-in TDD flow; it is written before any source change.
//
// Business invariant (T5):
//   The dispatcher UI must never expose UI controls that are
//   redundant, dead-end placeholders, or superseded by safer flows.
//   Concretely:
//     1. AppShell nav must NOT render placeholder links 'Đơn hàng' or 'Báo cáo'
//        (they are href='#' dead-ends that confuse dispatchers).
//     2. The Lệnh điều xe - Tải thùng form (CreateOrderForm) must NOT render
//        a 'Đặt lại' reset button (mid-creation reset is a footgun; the
//        dispatcher reloads the page or creates a new order instead).
//     3. The Quản lý tài xế & xe page (/admin/drivers) must NOT render a
//        per-row 'Sửa' inline-rename control (Xóa + re-create supersedes it).
//     4. The Quản lý dữ liệu điều phối page (/admin/reference) must NOT
//        render a per-row 'Sửa' inline-rename control (same reasoning).
//
// Critical user journey: a dispatcher logs in, navigates the shell, opens
// the create-order form, then visits the two admin pages. None of the
// redundant controls listed above are visible on any of those screens.
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';


// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}

test.describe.serial('T5: redundant UI elements are absent from dispatcher experience', () => {
  test('AppShell nav does not render placeholder Đơn hàng or Báo cáo links', async ({ page }) => {
    await login(page);
    const banner = page.getByRole('banner');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner.getByRole('link', { name: /^Đơn hàng$/ })).toHaveCount(0);
    await expect(banner.getByRole('link', { name: /^Báo cáo$/ })).toHaveCount(0);
  });
  test('Lệnh điều xe - Tải thùng form does not render Đặt lại reset button', async ({ page }) => {
    await login(page);
    const form = page.locator('form').filter({ hasText: /Lệnh điều xe/i });
    await expect(form).toBeVisible({ timeout: 15_000 });
    await expect(form.getByRole('button', { name: /^Đặt lại$/ })).toHaveCount(0);
  });
  test('Quản lý tài xế & xe page does not render per-row Sửa buttons', async ({ page }) => {
    await login(page);
    await page.goto('/admin/drivers');
    await expect(page.getByRole('heading', { name: /Quản lý tài xế/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^Sửa$/ })).toHaveCount(0);
  });
  test('Quản lý dữ liệu điều phối page does not render per-row Sửa buttons', async ({ page }) => {
    await login(page);
    await page.goto('/admin/reference');
    await expect(page.getByRole('heading', { name: /Quản lý dữ liệu điều phối/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^Sửa$/ })).toHaveCount(0);
  });
});
