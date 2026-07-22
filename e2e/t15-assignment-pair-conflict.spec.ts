// e2e/t15-assignment-pair-conflict.spec.ts
// T15 acceptance (outside-in RED): assigning a vehicle that another driver
// already actively holds MUST surface the per-constraint localized Vietnamese
// conflict copy in the dispatcher UI -- never the English fallback text, never
// an HTTP 500.
//
// Business invariant (T15):
//   POST /api/admin/driver-vehicle-assignments violating
//   dva_one_active_per_vehicle_uq MUST resolve as HTTP 409 carrying the
//   machine-readable code VEHICLE_ALREADY_ASSIGNED, and the ops-web presenter
//   MUST map that code to the Vietnamese copy asserted below.
//
// WHY this is RED today (two independent breaks, either alone fatal):
//   1. problem-details-exception.filter STATUS_CODES has no 409 entry, so a
//      bare ConflictException emits an envelope with NO code member.
//   2. admin-drivers-client.assign throws Error(POST ... HTTP 409); the
//      vnExceptionMessage regex is anchored at string start, so it never
//      matches, the parsed body is passed as undefined, and the dispatcher
//      gets the English fallback instead of the localized copy.
//
// Vietnamese strings are immutable contracts, asserted verbatim (house rule).
//
// Critical user journey: an admin opens the drivers admin page and assigns a
// vehicle that another driver already holds.
import { test, expect, type Page } from '@playwright/test';
import { dockerPsql } from './helpers/docker-exec';
import { loginAs } from './helpers/auth';

const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
// Verbatim from AdminAssignmentService.assign dva_one_active_per_vehicle_uq branch.
const VEHICLE_TAKEN_VN = /Xe này đã được phân công cho một tài xế khác/i;

// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}

function cleanup(): void {
  const sq = String.fromCharCode(39);
  dockerPsql('DELETE FROM driver_vehicle_assignment WHERE company_id=' + sq + COMPANY_ID + sq +
    ' AND (vehicle_id IN (SELECT vehicle_id FROM vehicle WHERE plate LIKE ' + sq + 'E2E-T15-%' + sq + ')' +
    ' OR driver_id IN (SELECT driver_id FROM driver WHERE full_name LIKE ' + sq + 'E2E T15 %' + sq + '));');
  dockerPsql('DELETE FROM vehicle WHERE company_id=' + sq + COMPANY_ID + sq + ' AND plate LIKE ' + sq + 'E2E-T15-%' + sq + ';');
  dockerPsql('DELETE FROM driver WHERE company_id=' + sq + COMPANY_ID + sq + ' AND full_name LIKE ' + sq + 'E2E T15 %' + sq + ';');
}

test('assigning an already-held vehicle surfaces localized conflict copy, not the English fallback', async ({ page }) => {
  const sq = String.fromCharCode(39);
  cleanup();
  // Seed driver A (the holder) and driver B (attempts the collision).
  for (const name of ['E2E T15 DRIVER A', 'E2E T15 DRIVER B']) {
    dockerPsql(
      'INSERT INTO driver (driver_id, company_id, business_unit_id, depot_id, legal_entity_id, full_name) VALUES ' +
      '(gen_random_uuid(), ' + sq + COMPANY_ID + sq + ', ' + sq + COMPANY_ID + sq + ', ' + sq + COMPANY_ID + sq + ', ' +
      sq + COMPANY_ID + sq + ', ' + sq + name + sq + ');',
    );
  }
  dockerPsql(
    'INSERT INTO vehicle (vehicle_id, company_id, business_unit_id, depot_id, legal_entity_id, plate) VALUES ' +
    '(gen_random_uuid(), ' + sq + COMPANY_ID + sq + ', ' + sq + COMPANY_ID + sq + ', ' + sq + COMPANY_ID + sq + ', ' +
    sq + COMPANY_ID + sq + ', ' + sq + 'E2E-T15-001' + sq + ');',
  );
  // Driver A already actively holds E2E-T15-001, so dva_one_active_per_vehicle_uq
  // is armed against anyone else selecting that plate.
  dockerPsql(
    'INSERT INTO driver_vehicle_assignment (assignment_id, driver_id, vehicle_id, company_id, business_unit_id, depot_id, legal_entity_id) ' +
    'SELECT gen_random_uuid(), d.driver_id, v.vehicle_id, ' + sq + COMPANY_ID + sq + ', ' + sq + COMPANY_ID + sq + ', ' +
    sq + COMPANY_ID + sq + ', ' + sq + COMPANY_ID + sq + ' FROM driver d, vehicle v WHERE d.company_id=' + sq + COMPANY_ID + sq +
    ' AND d.full_name=' + sq + 'E2E T15 DRIVER A' + sq + ' AND v.plate=' + sq + 'E2E-T15-001' + sq + ';',
  );

  // A native alert() never enters the DOM, so the t5b toContainText model cannot
  // see it: capture the dialog text off the page event instead.
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });

  await login(page);
  await page.goto('/admin/drivers');
  const row = page.locator('li, tr').filter({ hasText: 'E2E T15 DRIVER B' }).last();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const select = row.locator('select').first();
  await select.selectOption({ label: 'E2E-T15-001' });
  // Branch-tolerant across the in-flight #302 arc: the UDID input exists on
  // develop and is REMOVED by that arc, and the button label changes from
  // 'Phân công & đăng ký' to 'Phân công'. Fill only when present and anchor the
  // button regex at the shared prefix, so this spec holds on both sides of that
  // merge rather than becoming the next t5e landmine.
  const udid = row.locator('input[placeholder*=UDID i]');
  if (await udid.count() > 0) await udid.first().fill('E2E-T15-UDID');
  await row.getByRole('button', { name: /^Phân công/ }).click();

  await expect.poll(() => dialogs.join(' | '), { timeout: 15_000 }).toMatch(VEHICLE_TAKEN_VN);
  expect(dialogs.join(' | ')).not.toMatch(/assign failed/i);
  expect(dialogs.join(' | ')).not.toMatch(/HTTP 500/);
  cleanup();
});
