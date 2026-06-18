// e2e/admin-drivers-no-soft-deleted-leak.spec.ts
import { test, expect } from '@playwright/test';
import { dockerPsql } from './helpers/docker-exec';
import { loginAs } from './helpers/auth';

test.describe.serial('admin drivers page excludes soft-deleted rows', () => {
  test('soft-deleted E2E drivers never render in Quan ly tai xe & xe', async ({ page }) => {
    const sq = String.fromCharCode(39);
    const probe = 'E2E DRIVER SOFTDEL ' + String(Date.now());
    const zero = '00000000-0000-0000-0000-000000000000';
    const opId = '00000000-0000-0000-0000-0000000000cc';
    const insert =
      'INSERT INTO driver (driver_id, company_id, business_unit_id, depot_id, legal_entity_id, full_name, phone, password_hash, operator_id, active) VALUES (' +
      'gen_random_uuid(), ' +
      sq + zero + sq + ', ' + sq + zero + sq + ', ' + sq + zero + sq + ', ' + sq + zero + sq + ', ' +
      sq + probe + sq + ', ' + sq + '09' + String(Date.now()).slice(-8) + sq + ', ' +
      sq + 'x' + sq + ', ' + sq + opId + sq + ', false);';
    const ins = dockerPsql(insert);
    if (ins.failed) throw new Error('seed insert failed: ' + ins.stderr);

    // Authenticate via injected session (e2e/helpers/auth.ts): ops-web now uses
    // Authorization Code + PKCE, so there is no credential form to fill. The
    // helper mints a stepped-up dispatcher token and sets fleet_session.
    await loginAs(page);

    await page.goto('/admin/drivers');
    await expect(page.getByRole('heading', { name: /Quản lý tài xế|tài xế & xe/i })).toBeVisible({ timeout: 10000 });

    await expect(page.getByText(probe, { exact: false })).toHaveCount(0);

    const cleanup = dockerPsql(
      'DELETE FROM driver WHERE full_name = ' + sq + probe + sq + ';',
    );
    if (cleanup.failed) throw new Error('cleanup failed: ' + cleanup.stderr);
  });
});
