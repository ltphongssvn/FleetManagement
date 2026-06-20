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
    //
    // We must NOT drive the real external Google/MFA pages in CI, and Next.js
    // does not reliably auto-follow a server-action redirect() to an ABSOLUTE
    // external URL (vercel/next.js #72842). Polling the cookie jar AFTER that
    // external navigation is therefore racy -- whether the action's Set-Cookie
    // lands in the browser jar depends on the browser following a redirect it
    // often does not follow, which flakes in CI.
    //
    // The 2026-deterministic pattern (Playwright network interception): register
    // a route that ABORTS the navigation to the external IdP authorize endpoint
    // BEFORE clicking. The startLogin POST still completes and its Set-Cookie is
    // still applied to the browser context; we just prevent the browser from
    // leaving for Keycloak. Capturing the navigation attempt also positively
    // proves startLogin reached its redirect() to the authorize URL. The
    // callback route's own behavior is covered separately.
    const authorizeEndpoint = process.env['OIDC_AUTHORIZATION_ENDPOINT'];
    if (typeof authorizeEndpoint !== 'string' || authorizeEndpoint.length === 0) {
      throw new Error('OIDC_AUTHORIZATION_ENDPOINT must be set for the e2e webServer');
    }
    let authorizeNavigationSeen = false;
    // Abort any top-level navigation to the IdP authorize endpoint so the browser
    // never leaves the app; record that the attempt happened.
    await page.route(`${authorizeEndpoint}**`, async (route) => {
      authorizeNavigationSeen = true;
      await route.abort();
    });
    await page.getByRole('button', { name: /keycloak|sign in|đăng nhập/i }).click();
    // The transient PKCE secrets must now be present in the browser cookie jar.
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
    // And startLogin must have attempted to redirect to the IdP authorize URL.
    expect(authorizeNavigationSeen, 'startLogin must redirect to the IdP authorize endpoint').toBe(true);
  });
});
