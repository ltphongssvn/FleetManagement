// apps/ops-web/src/app/api/auth/callback/route.ts
// Completes the browser Authorization Code + PKCE flow. Validates state against
// the httpOnly cookie (CSRF), exchanges code + code_verifier at the token endpoint
// (public client, no secret), stores the access token as the fleet_session bearer
// cookie (unchanged downstream contract), clears the transient PKCE cookies, and
// redirects home. Any error/mismatch redirects to /login?error=... - the code is
// never exchanged when state fails, and fleet_session is only set on success.
//
// COOKIE WRITES MUST BE ON THE RESPONSE OBJECT: next/headers cookies().set/delete
// do not attach their Set-Cookie headers to a separately-constructed
// NextResponse.redirect(), so writes made via the ambient cookie store are
// silently dropped from the redirect actually sent to the browser (the
// fleet_session is never stored and the transient cookies are never cleared --
// vercel/next.js#47126). We READ the incoming cookies from the request, but every
// WRITE (set fleet_session, delete the three transient PKCE cookies) is applied to
// the NextResponse we return, so the Set-Cookie headers ride along on the redirect.
import { NextResponse, type NextRequest } from 'next/server';
import { TokenResponseSchema } from '@/features/auth/oidc-authorization.schema';
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  refreshCookieOptions,
  sessionCookieOptions,
} from '@/features/auth/session-refresh';
import {
  decodeAccessTokenClaims,
  evaluatePasswordlessLogin,
  DISPATCHER_PASSWORDLESS_POLICY,
} from '@/features/auth/oidc-token-claims.schema';
const TRANSIENT_COOKIES = ['oidc_code_verifier', 'oidc_state', 'oidc_nonce'] as const;
// Clear the single-use PKCE cookies on the OUTGOING response (not the ambient
// store) so the deletions are actually sent to the browser.
function clearTransient(res: NextResponse): NextResponse {
  for (const name of TRANSIENT_COOKIES) {
    res.cookies.delete(name);
  }
  return res;
}
// Resolve the PUBLIC origin to build same-site redirect URLs against. Behind
// Railway's edge proxy, req.url's host is the container's internal bind
// (0.0.0.0:3001), so `new URL('/', req.url)` would redirect the browser to
// https://0.0.0.0:3001/ (ERR_ADDRESS_INVALID) -- Railway runs the app as-is and
// does not rewrite localhost/0.0.0.0 to the public domain. Prefer the forwarded
// host/proto the proxy sets; otherwise fall back to the origin of
// OIDC_REDIRECT_URI (already configured to the public callback URL, e.g.
// https://xe.vominhchau.com/...); finally fall back to req.url for local/dev.
function publicOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host');
  if (forwardedHost !== null && forwardedHost.length > 0) {
    const proto = req.headers.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${forwardedHost}`;
  }
  const redirectUri = process.env['OIDC_REDIRECT_URI'];
  if (redirectUri !== undefined && redirectUri.length > 0) {
    try {
      return new URL(redirectUri).origin;
    } catch {
      // fall through to req.url
    }
  }
  return new URL(req.url).origin;
}
function loginRedirect(req: NextRequest, reason: string): NextResponse {
  const url = new URL('/login', publicOrigin(req));
  url.searchParams.set('error', reason);
  return clearTransient(NextResponse.redirect(url));
}
export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = new URL(req.url).searchParams;
  if (params.get('error') !== null) {
    return loginRedirect(req, params.get('error') ?? 'authorization_failed');
  }
  const code = params.get('code');
  const returnedState = params.get('state');
  // Read transient cookies from the REQUEST (reads are fine via req.cookies).
  const expectedState = req.cookies.get('oidc_state')?.value;
  const codeVerifier = req.cookies.get('oidc_code_verifier')?.value;
  // CSRF: the state echoed back must match the one minted at redirect time.
  if (
    code === null ||
    returnedState === null ||
    expectedState === undefined ||
    returnedState !== expectedState
  ) {
    return loginRedirect(req, 'invalid_state');
  }
  if (codeVerifier === undefined) {
    return loginRedirect(req, 'missing_verifier');
  }
  const tokenEndpoint = process.env['OIDC_TOKEN_ENDPOINT'];
  const clientId = process.env['OIDC_CLIENT_ID'];
  const redirectUri = process.env['OIDC_REDIRECT_URI'];
  if (
    tokenEndpoint === undefined ||
    clientId === undefined ||
    redirectUri === undefined
  ) {
    return loginRedirect(req, 'oidc_not_configured');
  }
  const exchange = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString(),
    cache: 'no-store',
  });
  if (!exchange.ok) {
    return loginRedirect(req, 'token_exchange_failed');
  }
  const json: unknown = await exchange.json();
  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    return loginRedirect(req, 'invalid_token_response');
  }
  // STRICT STEP-UP GATE: a successful code->token exchange is necessary but NOT
  // sufficient. The passwordless guarantee (no password factor exists) is only
  // real if we refuse any token that does not prove (a) the identity was brokered
  // through Google and (b) a phishing-resistant WebAuthn passkey was used (aal3).
  // Decode the access-token claims (signature verification is the API's job via
  // JWKS; we only read acr/idp here) and evaluate the dispatcher policy. A token
  // that is not a decodable JWT, or that fails the policy, never becomes a
  // session -- we redirect to /login with a precise reason and set no cookie.
  let claims;
  try {
    claims = decodeAccessTokenClaims(parsed.data.access_token);
  } catch {
    return loginRedirect(req, 'invalid_token_claims');
  }
  const gate = evaluatePasswordlessLogin(claims, DISPATCHER_PASSWORDLESS_POLICY);
  if (!gate.ok) {
    return loginRedirect(req, gate.reason);
  }
  // Success: set fleet_session and clear the transient cookies, all on the
  // OUTGOING redirect response so the Set-Cookie headers reach the browser.
  const res = NextResponse.redirect(new URL('/', publicOrigin(req)));
  res.cookies.set(
    SESSION_COOKIE,
    parsed.data.access_token,
    sessionCookieOptions(parsed.data.expires_in ?? 3600),
  );
  // Root cause of mid-shift /login bounces: Keycloak returned a refresh_token
  // here and we DISCARDED it, so nothing could ever silently re-mint the
  // session. Store it (httpOnly) so proxy/_forward/refresh-route can.
  if (parsed.data.refresh_token !== undefined) {
    res.cookies.set(REFRESH_COOKIE, parsed.data.refresh_token, refreshCookieOptions());
  }
  return clearTransient(res);
}
