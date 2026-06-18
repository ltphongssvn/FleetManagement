// e2e/helpers/auth.ts
// Shared E2E authentication helper.
//
// ops-web moved from the ROPC password grant to an Authorization Code + PKCE
// redirect to Keycloak (which brokers Google Sign-in and enforces OTP/WebAuthn).
// E2E specs therefore cannot — and per 2026 best practice should not — drive the
// real interactive login: the credential form is gone and the federated MFA flow
// cannot complete in CI. Login is not the subject under test for the dispatch /
// admin specs, so we authenticate the way the official Playwright guidance and
// the SSO/MFA-bypass pattern prescribe: obtain a token non-interactively from the
// test IdP and inject it as the session cookie (API-based auth, no UI).
//
// The token comes from the in-stack mock OAuth2 server (the test analogue of a
// dev Keycloak — it signs real ES256 tokens; we do NOT disable validation). The
// 'dispatcher' mapping in compose.yaml mints a token whose claims model a
// dispatcher who has completed step-up (acr=aal2, amr includes a phishing-
// resistant method), so it satisfies the API's RFC 9470 StepUpGuard on
// POST /commands. No password and no per-spec login form are involved.
import type { Page } from '@playwright/test';
import { dockerExecNode } from './docker-exec';
import { TokenResponseSchema } from './contracts';

const API_CONTAINER = process.env['E2E_API_CONTAINER'] ?? 'fleet-pilot-api-1';
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3001';
const TOKEN_URL = process.env['E2E_OIDC_TOKEN_URL'] ?? 'http://mock-oauth2:8080/fleet/token';

// Mints an access token for a seeded test subject from the mock IdP. The grant
// is irrelevant to production (the mock server issues tokens for the configured
// subject regardless); it is a non-interactive token factory for tests. Returns
// a signed ES256 JWT the API accepts via its JWKS.
export function mintToken(username = 'dispatcher'): string {
  const body =
    'grant_type=password&username=' + username +
    '&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret';
  // The container script emits the FULL token response as JSON; the shape is
  // then validated on the Playwright side against TokenResponseSchema (the
  // OIDC token contract), so a malformed/error response fails here with a
  // descriptive ZodError rather than surfacing as a confusing downstream 401.
  const script =
    'fetch(' + JSON.stringify(TOKEN_URL) +
    ',{method:' + JSON.stringify('POST') +
    ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
    ',body:' + JSON.stringify(body) + '})' +
    '.then(r=>r.json()).then(j=>process.stdout.write(JSON.stringify(j)))';
  const out = dockerExecNode(API_CONTAINER, script);
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error('Token mint for ' + username + ' returned non-JSON: ' + out);
  }
  return TokenResponseSchema.parse(parsed).access_token;
}

// Convenience: the dispatcher identity the rest of the suite seeds under.
export const mintDispatcherToken = (): string => mintToken('dispatcher');

// Establishes an authenticated ops-web session WITHOUT the login UI: inject the
// minted JWT as the httpOnly fleet_session cookie (the same cookie the real
// callback sets and that the middleware + BFF read), then land on the board.
// page.request shares this cookie, so BFF -> API calls are authenticated too.
export async function loginAs(page: Page, username = 'dispatcher'): Promise<void> {
  const token = mintToken(username);
  await page.context().addCookies([
    { name: 'fleet_session', value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
  ]);
  await page.goto('/');
}
