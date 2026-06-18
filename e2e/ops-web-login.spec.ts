// e2e/ops-web-login.spec.ts
// ops-web /login now uses Authorization Code + PKCE: instead of a username/
// password form, it shows a single "Continue with Keycloak" button that, on
// submit, redirects the browser to the IdP's authorization endpoint (where
// Google brokering + OTP/WebAuthn happen). This spec asserts that login surface
// without completing the federated flow (which cannot run in CI). All other
// specs authenticate via the injected-session helper (e2e/helpers/auth.ts),
// never through this UI.
import { test, expect } from '@playwright/test';

test.describe('ops-web /login (Authorization Code + PKCE)', () => {
  test('renders the Keycloak sign-in button and no credential fields', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page.getByRole('button', { name: /keycloak|sign in|đăng nhập/i }),
    ).toBeVisible();
    // The ROPC form is gone — no username/password inputs remain.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('input[name="username"]')).toHaveCount(0);
  });

  test('submitting initiates a redirect toward the IdP authorize endpoint', async ({ page }) => {
    await page.goto('/login');
    // The form action calls the startLogin server action, which sets the PKCE
    // cookies and redirects to the authorization endpoint. We assert the browser
    // leaves /login heading to an OIDC authorize URL; we do NOT follow through
    // the external Google/MFA pages. Tolerate either a full external redirect or
    // a server-side error landing (?error=) if OIDC is unconfigured in-stack.
    await page.getByRole('button', { name: /keycloak|sign in|đăng nhập/i }).click();
    await page.waitForURL(
      (url) => /\/protocol\/openid-connect\/auth/.test(url.href) || /[?&]error=/.test(url.href) || !/\/login$/.test(url.pathname),
      { timeout: 15000 },
    );
    // PKCE transient cookies are set by the redirecting action.
    const cookies = await page.context().cookies();
    const names = cookies.map((c) => c.name);
    expect(names.includes('oidc_state') || /openid-connect\/auth/.test(page.url())).toBeTruthy();
  });
});
