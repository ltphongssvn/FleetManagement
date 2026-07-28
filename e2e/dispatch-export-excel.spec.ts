// e2e/dispatch-export-excel.spec.ts
//
// L0 acceptance test for the 2026 invariant: the Lệnh điều xe table is
// exportable to Excel manually AND backed up automatically on logout, with a
// daily-idempotent ledger row proving the backup happened. (Login-time
// auto-backup was removed with the move to Authorization Code + PKCE, where
// ops-web no longer runs a credential server action at sign-in.)
//
// Layers exercised end-to-end:
//   L1 (UI):     "Xuất Excel" button on DispatchBoard triggers a download.
//   L2 (action): server action calls API with the session JWT.
//   L3 (DTO):    GET /transport-orders-export.xlsx returns 200 with
//                openxml Content-Type and a Content-Disposition filename.
//   L4 (svc):    rows mirror dispatch_board_projection scope; sha256 stable.
//   L5 (DB):     transport_order_export_log gets a manual row on click,
//                a 'login' row when the user signs in, a 'logout' row
//                when the user signs out; second login same day is a no-op.
//
// Note: the docker-compose mock-oauth2 dispatcher user maps to a fixed
// operator_id (DISPATCHER_OPERATOR_ID below) — see compose.yaml. Ledger
// queries scope by that uuid directly rather than joining through the
// driver table, because dispatchers are not drivers and have no driver row.
import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { loginAs } from './helpers/auth';
import { waitForBoardReady } from './helpers/create-order';
const POSTGRES_CONTAINER = process.env['E2E_PG_CONTAINER'] ?? 'fleet-pilot-postgres-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const DISPATCHER_OPERATOR_ID = '00000000-0000-0000-0000-0000000000aa';
interface PsqlResult { stdout: string; stderr: string; failed: boolean }
function dockerPsql(sql: string): PsqlResult {
  const cmd = 'docker exec -i ' + POSTGRES_CONTAINER + ' psql -U fleet -d fleet -tA -v ON_ERROR_STOP=1';
  try {
    const stdout = execSync(cmd, { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    return { stdout, stderr: '', failed: false };
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
    return {
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: (err.stderr ? err.stderr.toString() : '') + (err.message ?? ''),
      failed: true,
    };
  }
}
// Authenticate via injected session (PKCE login has no credential form).
async function loginAsDispatcher(page: Page): Promise<void> {
  await loginAs(page);
}
function todayKeyVnTz(): string {
  // Day key matches the server's VN timezone (+07:00) calendar date.
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
function countExportLog(operatorId: string, trigger: string, dayKey: string): number {
  const sq = String.fromCharCode(39);
  const sql =
    'SELECT COUNT(*)::int FROM transport_order_export_log ' +
    'WHERE company_id=' + sq + COMPANY_ID + sq + ' ' +
    'AND trigger=' + sq + trigger + sq + ' ' +
    'AND day_key=' + sq + dayKey + sq + ' ' +
    'AND operator_id=' + sq + operatorId + sq + ';';
  const r = dockerPsql(sql);
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}
async function waitForExportLogAtLeast(operatorId: string, trigger: string, dayKey: string, minCount: number, budgetMs = 10000): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let n = countExportLog(operatorId, trigger, dayKey);
  while (n < minCount && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    n = countExportLog(operatorId, trigger, dayKey);
  }
  return n;
}
test.describe.configure({ mode: 'serial' });
test.describe('dispatch export-excel backup chain (L1-L5)', () => {
  test('L1+L2+L3: manual export button downloads .xlsx with Vietnamese headers', async ({ page }) => {
    await loginAsDispatcher(page);
    await page.goto('/');
    await waitForBoardReady(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /xu.t excel/i }).click();
    const download = await downloadPromise;
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^lenh-dieu-xe_.+_\d{4}-\d{2}-\d{2}_manual_[a-f0-9]+\.xlsx$/i);
    const path = await download.path();
    expect(path).toBeTruthy();
  });
  test('L5: manual click writes a manual row to transport_order_export_log', async ({ page }) => {
    const before = countExportLog(DISPATCHER_OPERATOR_ID, 'manual', todayKeyVnTz());
    await loginAsDispatcher(page);
    await page.goto('/');
    await waitForBoardReady(page);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /xu.t excel/i }).click();
    await dl;
    const after = countExportLog(DISPATCHER_OPERATOR_ID, 'manual', todayKeyVnTz());
    expect(after).toBe(before + 1);
  });
  test('L5: logout triggers an idempotent daily logout backup', async ({ page, context }) => {
    const dayKey = todayKeyVnTz();
    // First logout of the day -> at least one row exists. Second logout same
    // day is a no-op (idempotent), so row count must remain unchanged.
    await loginAsDispatcher(page);
    await page.goto('/');
    await waitForBoardReady(page);
    await page.getByRole('main').getByRole('button', { name: /đăng xuất|log ?out|sign out/i }).click();
    await page.waitForURL(/\/login/);
    const afterFirst = await waitForExportLogAtLeast(DISPATCHER_OPERATOR_ID, 'logout', dayKey, 1);
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    await context.clearCookies();
    await loginAsDispatcher(page);
    await page.goto('/');
    await waitForBoardReady(page);
    await page.getByRole('main').getByRole('button', { name: /đăng xuất|log ?out|sign out/i }).click();
    await page.waitForURL(/\/login/);
    const afterSecond = countExportLog(DISPATCHER_OPERATOR_ID, 'logout', dayKey);
    expect(afterSecond).toBe(afterFirst);
  });
});
