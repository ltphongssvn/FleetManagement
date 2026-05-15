// e2e/driver-app-diag.spec.ts
// Diagnostic only.
import { test } from '@playwright/test';

const DRIVER_APP_URL = process.env.DRIVER_APP_URL ?? 'http://localhost:8081';

test('diag: dump after /login (with long wait)', async ({ page }) => {
  test.setTimeout(180_000);
  const logs: string[] = [];
  page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  page.on('requestfailed', (r) => logs.push('[reqfail] ' + r.url() + ' ' + (r.failure()?.errorText ?? '')));
  await page.goto(DRIVER_APP_URL + '/login', { waitUntil: 'domcontentloaded' });
  for (const wait of [2000, 5000, 10000, 15000]) {
    await page.waitForTimeout(wait);
    const text = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    const rootLen = await page.evaluate(() => (document.getElementById('root')?.innerHTML ?? '').length);
    console.log('--- after +' + wait + 'ms: rootLen=' + rootLen + ' bodyText=' + JSON.stringify(text));
    if (text.includes('Fleet Driver')) break;
  }
  console.log('--- CONSOLE / ERRORS ---\n' + logs.join('\n'));
});
