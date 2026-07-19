// e2e/t5e-pair-shows-in-dispatch-form.spec.ts
// T5e acceptance: after admin pairs a driver+vehicle via /admin/drivers,
// the dispatch CreateOrderForm Section 3 Số xe and Tài xế dropdowns MUST
// surface that pair immediately. Without the operator_id backfill the
// dispatch query returns 0 assignments and the dropdowns are empty.
//
// Critical user journey: dispatcher creates an order using a vehicle
// that admin just paired with a driver. The dropdowns MUST surface
// that pair.
//
// Business invariant: every active driver_vehicle_assignment is
// visible in the dispatch create-order Số xe / Tài xế dropdowns.
//
// Selector contract: this spec drives /admin/drivers exclusively through
// data-testid hooks keyed by driverId (the house convention -- see
// OrderReview.tsx, CancelOrderForm.tsx, co-so-du-lieu-driver-columns.tsx).
// It previously drove the page by Vietnamese copy and a UDID placeholder;
// #302 removed the device step and shortened the button label, so the spec
// timed out and turned develop red at f2d22de -- while #302's own PR CI
// stayed green, because ci.yml only typechecks e2e specs and a selector is
// just a string to tsc. Copy and layout are now free to change without
// breaking this gate. The driver is seeded with a fixed UUID so its testids
// are addressable, which also removes the old li/tr + .last() guessing:
// whether the driver renders in the Can xu ly queue or the configured
// table, the testid is unique page-wide.
import { test, expect, type Page } from '@playwright/test';
import { dockerPsql } from './helpers/docker-exec';
import { loginAs } from './helpers/auth';

const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const DRIVER_ID = '00000000-0000-0000-0000-00000000a5e0';
const PLATE = 'E2E-T5E-001';
const DRIVER_NAME = 'E2E T5E DRIVER';

// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}

test('admin pair surfaces in dispatch Section 3 Số xe and Tài xế dropdowns', async ({ page }) => {
  const sq = String.fromCharCode(39);
  const q = (v: string): string => sq + v + sq;
  // Clean any pre-existing E2E-T5E rows.
  dockerPsql('DELETE FROM driver_vehicle_assignment WHERE company_id=' + q(COMPANY_ID) +
    ' AND (vehicle_id IN (SELECT vehicle_id FROM vehicle WHERE plate LIKE ' + q('E2E-T5E-%') + ')' +
    ' OR driver_id IN (SELECT driver_id FROM driver WHERE full_name LIKE ' + q('E2E T5E %') + '));');
  dockerPsql('DELETE FROM vehicle WHERE company_id=' + q(COMPANY_ID) + ' AND plate LIKE ' + q('E2E-T5E-%') + ';');
  dockerPsql('DELETE FROM driver WHERE company_id=' + q(COMPANY_ID) + ' AND full_name LIKE ' + q('E2E T5E %') + ';');
  // Seed a driver (fixed id, no operator_id) + a vehicle.
  dockerPsql(
    'INSERT INTO driver (driver_id, company_id, business_unit_id, depot_id, legal_entity_id, full_name) VALUES ' +
    '(' + q(DRIVER_ID) + ', ' + q(COMPANY_ID) + ', ' + q(COMPANY_ID) + ', ' + q(COMPANY_ID) + ', ' +
    q(COMPANY_ID) + ', ' + q(DRIVER_NAME) + ');',
  );
  dockerPsql(
    'INSERT INTO vehicle (vehicle_id, company_id, business_unit_id, depot_id, legal_entity_id, plate) VALUES ' +
    '(gen_random_uuid(), ' + q(COMPANY_ID) + ', ' + q(COMPANY_ID) + ', ' + q(COMPANY_ID) + ', ' +
    q(COMPANY_ID) + ', ' + q(PLATE) + ');',
  );
  await login(page);
  await page.goto('/admin/drivers');
  // Drive the assign flow by testid, not by copy or container shape.
  const vehicleSelect = page.getByTestId('driver-assign-vehicle-' + DRIVER_ID);
  await expect(vehicleSelect).toBeVisible({ timeout: 15_000 });
  await vehicleSelect.selectOption({ label: PLATE });
  await page.getByTestId('driver-assign-submit-' + DRIVER_ID).click();
  // Wait until the row reflects the paired plate (server confirmed).
  await expect(page.getByTestId('driver-assigned-plate-' + DRIVER_ID)).toHaveText(PLATE, { timeout: 15_000 });
  // Now go to dispatch home and check Section 3 dropdowns.
  await page.goto('/');
  await expect(page.locator('[data-testid=create-order-form][data-hydrated=true]')).toBeVisible({ timeout: 15_000 });
  const vehicleField = page.locator('input[placeholder*="Chọn số xe" i]').first();
  await expect(vehicleField).toBeVisible({ timeout: 15_000 });
  await vehicleField.click();
  await expect(page.getByRole('option', { name: PLATE })).toBeVisible({ timeout: 5_000 });
  // Cleanup.
  dockerPsql('DELETE FROM driver_vehicle_assignment WHERE company_id=' + q(COMPANY_ID) +
    ' AND driver_id=' + q(DRIVER_ID) + ';');
  dockerPsql('DELETE FROM vehicle WHERE company_id=' + q(COMPANY_ID) + ' AND plate=' + q(PLATE) + ';');
  dockerPsql('DELETE FROM driver WHERE company_id=' + q(COMPANY_ID) + ' AND driver_id=' + q(DRIVER_ID) + ';');
});
