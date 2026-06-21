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
    // Clicking the button invokes the startLogin server action, which builds the
    // Authorization Code + PKCE request, persists the transient
    // code_verifier/state/nonce as httpOnly cookies, then redirect()s to the IdP
    // authorize endpoint.
    //
    // ROOT CAUSE of the earlier CI flakiness, now fixed deterministically:
    // `redirect()` INSIDE A SERVER ACTION does NOT make the browser navigate to
    // the target as a separate top-level request. Per the Next.js docs, a
    // server-action redirect() is returned as a 303 (See Other) ON THE
    // SERVER-ACTION POST RESPONSE ITSELF (the Location is a response header), and
    // for an ABSOLUTE EXTERNAL URL the Next client runtime does not reliably
    // issue a browser navigation to it (vercel/next.js #73536/#72842). So there
    // is NO interceptable browser request to the authorize endpoint:
    // page.route()/waitForRequest on it can never fire, and polling the cookie
    // jar after a click raced the POST. Both earlier approaches were therefore
    // wrong about WHERE the signal is.
    //
    // The deterministic, in-our-control signal is the SERVER-ACTION POST RESPONSE
    // (2026 guidance: for redirects/server actions, assert response status and
    // headers). We waitForResponse on that POST (same-origin, identified by the
    // `next-action` header), then assert: (a) it carries the authorize URL in its
    // redirect Location header (proving startLogin reached redirect() with the
    // right target), and (b) the three transient PKCE cookies are now in the jar
    // (its Set-Cookie has applied once the response resolved). No cross-origin
    // navigation, no external pages driven in CI. The callback route is covered
    // by unit tests.
    const authorizeEndpoint = process.env['OIDC_AUTHORIZATION_ENDPOINT'];
    if (typeof authorizeEndpoint !== 'string' || authorizeEndpoint.length === 0) {
      throw new Error('OIDC_AUTHORIZATION_ENDPOINT must be set for the e2e webServer');
    }
    // Arm the synchronizer BEFORE the click: the server-action POST back to the
    // /login route (Next server-action submissions carry a `next-action` header).
    const actionResponsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        res.url().includes('/login') &&
        res.request().headers()['next-action'] !== undefined,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: /keycloak|sign in|đăng nhập/i }).click();
    const actionResponse = await actionResponsePromise;
    // The server-action redirect() surfaces as a redirect on this POST response.
    // Next encodes the target either in the standard `location` header or in its
    // `x-action-redirect` header depending on version; accept either and require
    // it to point at the configured authorize endpoint.
    const headers = actionResponse.headers();
    // Next.js server-action redirects encode the RedirectType as a trailing
    // ";push"/";replace" on the header value (e.g. "<url>;push"); strip it before
    // comparing. The header is `location` or, depending on Next version,
    // `x-action-redirect`.
    const rawRedirect = headers['location'] ?? headers['x-action-redirect'] ?? '';
    const redirectTarget = rawRedirect.replace(/;(push|replace)$/, '');
    expect(
      redirectTarget.startsWith(authorizeEndpoint),
      `startLogin must redirect to the IdP authorize endpoint (expected prefix: "${authorizeEndpoint}", got: "${rawRedirect}")`,
    ).toBe(true);
    // The transient PKCE secrets are deterministically present now: the action
    // response that set them (via Set-Cookie) has already resolved.
    const names = (await page.context().cookies()).map((c) => c.name);
    expect(names, 'startLogin must set the three transient PKCE cookies').toEqual(
      expect.arrayContaining(['oidc_code_verifier', 'oidc_state', 'oidc_nonce']),
    );
  });
});
