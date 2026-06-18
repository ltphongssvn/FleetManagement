// apps/ops-web/src/features/auth/login.action.ts
// Server Action: initiates the browser Authorization Code + PKCE login against
// Keycloak (replacing the removed ROPC password grant). It builds the authorize
// request via the pure builder, persists the transient PKCE/anti-forgery secrets
// (code_verifier, state, nonce) in httpOnly cookies, then redirects the browser
// to Keycloak. The /api/auth/callback route validates state and exchanges the
// code for tokens. No password is ever collected or sent by ops-web.
'use server';
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { buildAuthorizationRequest, type PkceRandomSource } from './oidc-pkce';

export type LoginState = undefined | { status: 'server_error'; message: string };

// Cryptographically strong, URL-safe entropy from the Web Crypto RNG.
const webCryptoRandom: PkceRandomSource = {
  randomBase64Url: (byteLength = 32): string => {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('base64url');
  },
};

const TRANSIENT_COOKIE = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 600,
} as const;

export async function startLogin(): Promise<LoginState> {
  const authorizationEndpoint = process.env['OIDC_AUTHORIZATION_ENDPOINT'];
  const clientId = process.env['OIDC_CLIENT_ID'];
  const redirectUri = process.env['OIDC_REDIRECT_URI'];
  if (!authorizationEndpoint || !clientId || !redirectUri) {
    return { status: 'server_error', message: 'OIDC login is not configured' };
  }

  const acrValues = process.env['OIDC_DISPATCH_ACR_VALUES'];
  const request = await buildAuthorizationRequest(
    {
      authorizationEndpoint,
      clientId,
      redirectUri,
      ...(acrValues !== undefined && acrValues.length > 0 ? { acrValues } : {}),
    },
    webCryptoRandom,
  );

  const cookieStore = await cookies();
  cookieStore.set('oidc_code_verifier', request.codeVerifier, TRANSIENT_COOKIE);
  cookieStore.set('oidc_state', request.state, TRANSIENT_COOKIE);
  cookieStore.set('oidc_nonce', request.nonce, TRANSIENT_COOKIE);

  redirect(request.authorizeUrl);
}
