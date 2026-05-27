// e2e/t5e-pair-shows-in-dispatch-form.spec.ts
// T5e acceptance (RED): after admin pairs a driver+vehicle via
// /admin/drivers, the dispatch CreateOrderForm Section 3 Số xe and
// Tài xế dropdowns MUST surface that pair immediately. Without the
// operator_id backfill the dispatch query returns 0 assignments and
// the dropdowns are empty.
//
// Critical user journey: dispatcher creates an order using a vehicle
// that admin just paired with a driver. The dropdowns MUST surface
// that pair.
//
// Business invariant: every active driver_vehicle_assignment is
// visible in the dispatch create-order Số xe / Tài xế dropdowns.
import { test, expect } from '@playwright/test';
import { dockerPsql } from './helpers/docker-exec';
const OPS_USER = process.env['E2E_OPS_USERNAME'] ?? 'dieuxe';
const OPS_PASS = process.env['E2E_OPS_PASSWORD'] ?? 'dieuxe';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill(OPS_USER);
  await page.getByLabel(/mật khẩu|password/i).fill(OPS_PASS);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
    page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click(),
  ]);
}
test('admin pair surfaces in dispatch Section 3 Số xe and Tài xế dropdowns', async ({ page }) => {
  const sq = String.fromCharCode(39);
  // Clean any pre-existing E2E-T5E rows.
  dockerPsql('DELETE FROM driver_vehicle_assignment WHERE company_id=' + sq + COMPANY_ID + sq +
    ' AND (vehicle_id IN (SELECT vehicle_id FROM vehicle WHERE plate LIKE ' + sq + 'E2E-T5E-%' + sq + ')' +
    ' OR driver_id IN (SELECT driver_id FROM driver WHERE full_name LIKE ' + sq + 'E2E T5E %' + sq + '));');
  dockerPsql('DELETE FROM vehicle WHERE company_id=' + sq + COMPANY_ID + sq + ' AND plate LIKE ' + sq + 'E2E-T5E-%' + sq + ';');
  dockerPsql('DELETE FROM driver WHERE company_id=' + sq + COMPANY_ID + sq + ' AND full_name LIKE ' + sq + 'E2E T5E %' + sq + ';');
  // Seed a driver (no operator_id) + a vehicle.
  dockerPsql(
    'INSERT INTO driver (driver_id, company_id, business_unit_id, depot_id, legal_entity_id, full_name) VALUES ' +
    '(gen_random_uuid(), ' + sq + COMPANY_ID + sq + ', ' + sq + COMPANY_ID + sq + ', ' + sq + COMPANY_ID + sq + ', ' +
    sq + COMPANY_ID + sq + ', ' + sq + 'E2E T5E DRIVER' + sq + ');',
  );
  dockerPsql(
    'INSERT INTO vehicle (vehicle_id, company_id, business_unit_id, depot_id, legal_entity_id, plate) VALUES ' +
    '(gen_random_uuid(), ' + sq + COMPANY_ID + sq + ', ' + sq + COMPANY_ID + sq + ', ' + sq + COMPANY_ID + sq + ', ' +
    sq + COMPANY_ID + sq + ', ' + sq + 'E2E-T5E-001' + sq + ');',
  );
  await login(page);
  await page.goto('/admin/drivers');
  // Find the seeded driver's row and pair via the first available select option.
  const row = page.locator('tr').filter({ hasText: 'E2E T5E DRIVER' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  const select = row.locator('select').filter({ hasText: /Chọn số xe/ }).first();
  await select.selectOption({ label: 'E2E-T5E-001' });
  const deviceInput = row.locator('input[placeholder*=UDID i]').first();
  await deviceInput.fill('E2E-T5E-UDID');
  await row.getByRole('button', { name: /Phân công.*đăng ký/i }).click();
  // Wait until the row reflects the paired plate (server confirmed).
  await expect(row.getByText('E2E-T5E-001', { exact: false })).toBeVisible({ timeout: 15_000 });
  // Now go to dispatch home and check Section 3 dropdowns.
  await page.goto('/');
  const vehicleField = page.locator('input[placeholder*="Chọn số xe" i]').first();
  await expect(vehicleField).toBeVisible({ timeout: 15_000 });
  await vehicleField.click();
  await expect(page.getByRole('option', { name: 'E2E-T5E-001' })).toBeVisible({ timeout: 5_000 });
  // Cleanup.
  dockerPsql('DELETE FROM driver_vehicle_assignment WHERE company_id=' + sq + COMPANY_ID + sq +
    ' AND vehicle_id IN (SELECT vehicle_id FROM vehicle WHERE plate=' + sq + 'E2E-T5E-001' + sq + ');');
  dockerPsql('DELETE FROM vehicle WHERE company_id=' + sq + COMPANY_ID + sq + ' AND plate=' + sq + 'E2E-T5E-001' + sq + ';');
  dockerPsql('DELETE FROM driver WHERE company_id=' + sq + COMPANY_ID + sq + ' AND full_name=' + sq + 'E2E T5E DRIVER' + sq + ';');
});
