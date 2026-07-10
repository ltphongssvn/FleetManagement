// e2e/claim-parity.spec.ts
// Follow-up #7: browser-flow claim PARITY between the mock IdP and the ops-web
// callback's enforcement.
//
// Context. ops-web login is Authorization Code + PKCE. The callback
// (apps/ops-web/src/app/api/auth/callback/route.ts) does NOT trust a successful
// code->token exchange alone: it decodes the access token and runs
// evaluatePasswordlessLogin(claims, DISPATCHER_PASSWORDLESS_POLICY), REJECTING any
// token that is not acr>=aal3 AND idp=google (the passwordless guarantee: Google
// broker + phishing-resistant passkey). ops-web-login.spec.ts asserts the
// INITIATION half (button, PKCE cookies, redirect target) but explicitly stops
// before the federated flow; the injected-session helper (helpers/auth.ts) writes
// fleet_session directly, bypassing the callback. So NOTHING end-to-end verifies
// that the token the mock IdP issues on the CALLBACK's path actually satisfies the
// callback's policy.
//
// The mock (compose.yaml JSON_CONFIG) models this with TWO mappings:
//   - username=dispatcher  -> acr=aal2, amr=[pwd,hwk]   (the API StepUpGuard path)
//   - client_id=ops-web    -> acr=aal3, idp=google      (the CALLBACK path)
// The real callback exchanges grant_type=authorization_code with client_id=ops-web
// and NO username param, so mock-oauth2 matches the client_id rule (aal3+google).
// This spec mints a token on THAT path and asserts its claims clear the SAME
// policy the callback enforces, pinning the mock<->callback contract so a future
// edit to either the JSON_CONFIG or the policy cannot silently drift them apart.
//
// NOTE (Axis-2 backlog): decodeAccessTokenClaims / evaluatePasswordlessLogin /
// DISPATCHER_PASSWORDLESS_POLICY currently live in apps/ops-web/src and cannot be
// imported from the e2e project without a cross-app path alias. They are re-derived
// inline here against the SAME policy constants. The durable fix is to relocate the
// passwordless-policy contract into a shared package (@fleet/sync-protocol) so
// ops-web AND e2e consume one SSOT; recorded for a future in-domain arc.
import { test, expect } from '@playwright/test';
import { dockerExecNode } from './helpers/docker-exec';
import { TokenResponseSchema } from './helpers/contracts';

// The policy the ops-web callback enforces (mirrored from oidc-token-claims.schema).
const FLOOR_ACR = 'aal3' as const;
const REQUIRE_IDP = 'google' as const;
const LOA_ORDER = ['aal1', 'aal2', 'aal3'] as const;
const NUMERIC_TO_LOA: Record<string, string> = { '1': 'aal1', '2': 'aal2', '3': 'aal3' };

const API_CONTAINER = process.env['E2E_API_CONTAINER'] ?? 'fleet-pilot-api-1';
const TOKEN_URL = process.env['E2E_OIDC_TOKEN_URL'] ?? 'http://mock-oauth2:8080/fleet/token';

interface DecodedClaims { acr: string; idp: string | undefined; exp: number | undefined }

// Decode (not verify) a JWT payload — mirrors decodeAccessTokenClaims, normalizing
// a numeric acr to the canonical aalN symbol.
function decodeClaims(accessToken: string): DecodedClaims {
  const segments = accessToken.split('.');
  expect(segments.length, 'access token must be a 3-segment JWT').toBe(3);
  const payloadSegment = segments[1] ?? '';
  const json = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as Record<string, unknown>;
  const rawAcr = typeof json['acr'] === 'string' ? json['acr'] : '';
  const acr = NUMERIC_TO_LOA[rawAcr] ?? rawAcr;
  const idp = typeof json['idp'] === 'string' ? json['idp'] : undefined;
  const exp = typeof json['exp'] === 'number' ? json['exp'] : undefined;
  return { acr, idp, exp };
}

function meetsAcrFloor(acr: string, floor: string): boolean {
  const a = LOA_ORDER.indexOf(acr as (typeof LOA_ORDER)[number]);
  const f = LOA_ORDER.indexOf(floor as (typeof LOA_ORDER)[number]);
  return a >= 0 && f >= 0 && a >= f;
}

// Mint a token the way the CALLBACK does: client_id=ops-web, NO username param,
// so mock-oauth2 matches the client_id=ops-web mapping (the aal3+google identity).
function mintOpsWebClientToken(): string {
  const body =
    'grant_type=authorization_code&code=dummy&redirect_uri=http%3A%2F%2Flocalhost%2Fcb' +
    '&client_id=ops-web&client_secret=ops-web-secret';
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
    throw new Error('ops-web client token mint returned non-JSON: ' + out);
  }
  return TokenResponseSchema.parse(parsed).access_token;
}

test.describe('claim parity: mock IdP token satisfies the ops-web callback policy', () => {
  test('the callback-path token (client_id=ops-web) carries acr=aal3 and idp=google', () => {
    const token = mintOpsWebClientToken();
    const claims = decodeClaims(token);
    // These are the EXACT two conditions evaluatePasswordlessLogin enforces.
    expect(claims.acr, 'mock ops-web mapping must emit acr=aal3 (callback floor)').toBe(FLOOR_ACR);
    expect(claims.idp, 'mock ops-web mapping must emit idp=google (brokered guarantee)').toBe(REQUIRE_IDP);
  });

  test('the callback-path token clears the DISPATCHER_PASSWORDLESS_POLICY gate', () => {
    const token = mintOpsWebClientToken();
    const claims = decodeClaims(token);
    // Re-derive evaluatePasswordlessLogin: acr floor AND brokered idp.
    const clearsAcr = meetsAcrFloor(claims.acr, FLOOR_ACR);
    const brokered = claims.idp === REQUIRE_IDP;
    expect(clearsAcr, 'acr must meet the aal3 floor').toBe(true);
    expect(brokered, 'idp must be google').toBe(true);
    expect(clearsAcr && brokered, 'token must satisfy the full passwordless policy the callback applies').toBe(true);
  });

  test('the API step-up path (username=dispatcher) is DISTINCT: acr=aal2, no idp', () => {
    // Guards the design: the username mapping models the StepUpGuard (aal2) path,
    // which is deliberately WEAKER than the callback floor. If someone "fixes" the
    // mock by bumping this to aal3, this assertion fails and forces them to
    // understand the two paths are different on purpose.
    const body =
      'grant_type=password&username=dispatcher&password=x&scope=fleet' +
      '&client_id=ops-web&client_secret=ops-web-secret';
    const script =
      'fetch(' + JSON.stringify(TOKEN_URL) +
      ',{method:' + JSON.stringify('POST') +
      ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
      ',body:' + JSON.stringify(body) + '})' +
      '.then(r=>r.json()).then(j=>process.stdout.write(JSON.stringify(j)))';
    const out = dockerExecNode(API_CONTAINER, script);
    const token = TokenResponseSchema.parse(JSON.parse(out)).access_token;
    const claims = decodeClaims(token);
    expect(claims.acr, 'username=dispatcher mapping models the aal2 step-up path').toBe('aal2');
    expect(claims.idp, 'the aal2 step-up token is not brokered through an idp').toBeUndefined();
  });
});
