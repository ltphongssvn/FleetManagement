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
    // code_verifier/state/nonce as httpOnly cookies in its response, then
    // (3) redirect()s the browser to the IdP authorize endpoint.
    //
    // DETERMINISM (2026 Playwright guidance -- avoid the #1 flaky-test
    // anti-pattern of "click then immediately assert the click's async effect"):
    // a server action is a POST to the SAME page URL carrying a `next-action`
    // header; its response is what carries Set-Cookie and the redirect. The
    // earlier version clicked and then POLLED the cookie jar, racing that POST
    // and the subsequent cross-origin redirect (Next.js does not reliably
    // auto-follow a server-action redirect() to an ABSOLUTE external URL --
    // vercel/next.js #72842 -- so localhost timing flaked in CI, and the 2 CI
    // retries masked it). The fix is to SYNCHRONIZE on the actual network events
    // with waitForResponse/waitForRequest instead of polling:
    //   - wait for the server-action POST to /login to RESOLVE (cookies are set
    //     in that response, so after it resolves the jar is guaranteed populated)
    //   - wait for the REQUEST to the IdP authorize endpoint to be issued (proves
    //     startLogin reached its redirect()); we abort it so the browser never
    //     leaves for Keycloak / the real Google+MFA pages, which cannot run in CI.
    // The callback route's own behavior is covered separately (unit tests).
    const authorizeEndpoint = process.env['OIDC_AUTHORIZATION_ENDPOINT'];
    if (typeof authorizeEndpoint !== 'string' || authorizeEndpoint.length === 0) {
      throw new Error('OIDC_AUTHORIZATION_ENDPOINT must be set for the e2e webServer');
    }
    // Abort the navigation to the external IdP authorize endpoint so the browser
    // never leaves the app. Registering the route also lets us await the request
    // deterministically below (instead of polling a mutable boolean).
    await page.route(`${authorizeEndpoint}**`, async (route) => {
      await route.abort();
    });
    // Arm the deterministic synchronizers BEFORE the click:
    //  - the server-action POST back to the /login page (next-action submission)
    //  - the request attempt to the IdP authorize endpoint (the redirect target)
    const actionResponsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        res.url().includes('/login') &&
        res.request().headers()['next-action'] !== undefined,
      { timeout: 15000 },
    );
    const authorizeRequestPromise = page.waitForRequest(`${authorizeEndpoint}**`, {
      timeout: 15000,
    });
    await page.getByRole('button', { name: /keycloak|sign in|đăng nhập/i }).click();
    // The server action must complete; its response carries the Set-Cookie for
    // the three transient PKCE secrets, so once it resolves they are in the jar.
    await actionResponsePromise;
    // startLogin must have attempted to redirect to the IdP authorize URL.
    await authorizeRequestPromise;
    // Now the transient PKCE secrets are deterministically present (no polling
    // race): the action response that set them has already resolved.
    const names = (await page.context().cookies()).map((c) => c.name);
    expect(names, 'startLogin must set the three transient PKCE cookies').toEqual(
      expect.arrayContaining(['oidc_code_verifier', 'oidc_state', 'oidc_nonce']),
    );
  });
});
