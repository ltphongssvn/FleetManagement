// apps/ops-web/src/app/api/auth/callback/route.ts
// Completes the browser Authorization Code + PKCE flow. Validates state against
// the httpOnly cookie (CSRF), exchanges code + code_verifier at the token endpoint
// (public client, no secret), stores the access token as the fleet_session bearer
// cookie (unchanged downstream contract), clears the transient PKCE cookies, and
// redirects home. Any error/mismatch redirects to /login?error=... - the code is
// never exchanged when state fails, and fleet_session is only set on success.
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { TokenResponseSchema } from '@/features/auth/oidc-authorization.schema';

function loginRedirect(req: Request, reason: string): NextResponse {
  const url = new URL('/login', req.url);
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url);
}

export async function GET(req: Request): Promise<NextResponse> {
  const params = new URL(req.url).searchParams;
  const cookieStore = await cookies();

  // Always clear transient PKCE cookies on the way out - they are single-use.
  const clearTransient = (res: NextResponse): NextResponse => {
    cookieStore.delete('oidc_code_verifier');
    cookieStore.delete('oidc_state');
    cookieStore.delete('oidc_nonce');
    return res;
  };

  if (params.get('error') !== null) {
    return clearTransient(loginRedirect(req, params.get('error') ?? 'authorization_failed'));
  }

  const code = params.get('code');
  const returnedState = params.get('state');
  const expectedState = cookieStore.get('oidc_state')?.value;
  const codeVerifier = cookieStore.get('oidc_code_verifier')?.value;

  // CSRF: the state echoed back must match the one minted at redirect time.
  if (
    code === null ||
    returnedState === null ||
    expectedState === undefined ||
    returnedState !== expectedState
  ) {
    return clearTransient(loginRedirect(req, 'invalid_state'));
  }
  if (codeVerifier === undefined) {
    return clearTransient(loginRedirect(req, 'missing_verifier'));
  }

  const tokenEndpoint = process.env['OIDC_TOKEN_ENDPOINT'];
  const clientId = process.env['OIDC_CLIENT_ID'];
  const redirectUri = process.env['OIDC_REDIRECT_URI'];
  if (
    tokenEndpoint === undefined ||
    clientId === undefined ||
    redirectUri === undefined
  ) {
    return clearTransient(loginRedirect(req, 'oidc_not_configured'));
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
    return clearTransient(loginRedirect(req, 'token_exchange_failed'));
  }

  const json: unknown = await exchange.json();
  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    return clearTransient(loginRedirect(req, 'invalid_token_response'));
  }

  cookieStore.set('fleet_session', parsed.data.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: parsed.data.expires_in ?? 3600,
  });

  return clearTransient(NextResponse.redirect(new URL('/', req.url)));
}
