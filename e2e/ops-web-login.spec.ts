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

  test('submitting starts the PKCE flow: sets transient oidc cookies', async ({ page }) => {
    await page.goto('/login');
    // Clicking the button invokes the startLogin server action, which (1) builds
    // the Authorization Code + PKCE request, (2) persists the transient
    // code_verifier/state/nonce as httpOnly cookies, then (3) redirect()s the
    // browser to the IdP authorize endpoint. The deterministic, observable proof
    // that startLogin ran end-to-end is the three transient cookies being set;
    // we assert on those rather than on the cross-origin navigation itself.
    // Next.js does not reliably auto-follow a server-action redirect() to an
    // ABSOLUTE external URL (vercel/next.js #72842 and related), and we must NOT
    // drive the real external Google/MFA pages in CI regardless. The callback
    // route's own behavior is covered separately; here we verify the login
    // surface correctly initiates the flow.
    await page.getByRole('button', { name: /keycloak|sign in|đăng nhập/i }).click();
    // The action's Set-Cookie lands as the POST response is processed; poll the
    // cookie jar until the PKCE secrets appear (no fixed sleep).
    await expect
      .poll(
        async () => {
          const names = (await page.context().cookies()).map((c) => c.name);
          return (
            names.includes('oidc_code_verifier') &&
            names.includes('oidc_state') &&
            names.includes('oidc_nonce')
          );
        },
        { timeout: 15000, message: 'startLogin must set the three transient PKCE cookies' },
      )
      .toBe(true);
  });
});
