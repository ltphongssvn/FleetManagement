// apps/ops-web/src/features/auth/session-refresh.ts
// Silent-refresh seam (2026 BFF pattern): the refresh token lives ONLY in an
// httpOnly cookie; this pure function exchanges it at the Keycloak token
// endpoint (grant_type=refresh_token, public client + PKCE-issued RT) and
// returns rotated tokens, or null on any failure (expired/revoked/offline/
// malformed) -- callers decide whether that means 401 JSON (api routes) or a
// /login redirect (page navigations). Cookie names + options are the single
// contract shared by the OIDC callback, the /api/auth/refresh route, and the
// BFF forwarder.
import { z } from 'zod';
import { type NextRequest } from 'next/server';
import { TokenResponseSchema } from './oidc-authorization.schema';

export const SESSION_COOKIE = 'fleet_session';
export const REFRESH_COOKIE = 'fleet_refresh';

const SECURE = process.env.NODE_ENV === 'production';
// Refresh-token cookie outlives a dispatcher shift (12h); Keycloak's own
// SSO-session/refresh expiry remains the real ceiling.
const REFRESH_MAX_AGE_SECONDS = 12 * 3600;

export interface SessionCookieOptions {
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly secure: boolean;
  readonly maxAge: number;
}

export function sessionCookieOptions(maxAgeSeconds: number): SessionCookieOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: SECURE, maxAge: maxAgeSeconds };
}

export function refreshCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: SECURE,
    maxAge: REFRESH_MAX_AGE_SECONDS,
  };
}

// Env vars are a TRUST BOUNDARY (two-axis Zod rule, Axis 1): validate the
// shape at the edge instead of presence-checking strings by hand. The type
// derives from the schema (Axis 2 SSOT) -- no hand-written parallel interface.
export const RefreshEnvSchema = z.object({
  tokenEndpoint: z.url(),
  clientId: z.string().min(1),
});
export type RefreshEnv = z.infer<typeof RefreshEnvSchema>;

export interface RefreshedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

export async function refreshSession(
  refreshToken: string,
  env: RefreshEnv,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<RefreshedTokens | null> {
  try {
    const res = await fetchFn(env.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: env.clientId,
      }).toString(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const parsed = TokenResponseSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token ?? refreshToken,
      expiresIn: parsed.data.expires_in ?? 300,
    };
  } catch {
    return null;
  }
}

export function refreshEnvFromProcess(): RefreshEnv | null {
  const parsed = RefreshEnvSchema.safeParse({
    tokenEndpoint: process.env['OIDC_TOKEN_ENDPOINT'],
    clientId: process.env['OIDC_CLIENT_ID'],
  });
  return parsed.success ? parsed.data : null;
}

// Resolve the PUBLIC origin for same-site redirect URLs. Behind Railway's
// edge proxy, req.url's host is the container's internal bind (0.0.0.0:3001),
// so new URL(path, req.url) would send the browser to https://0.0.0.0:3001/...
// (ERR_ADDRESS_INVALID -- prod evidence 2026-07-11 on the session_expired
// path). Order: x-forwarded-host/proto set by the proxy; else the origin of
// OIDC_REDIRECT_URI (already the public callback URL); else req.url for
// local/dev. SSOT for the OIDC callback AND the /api/auth/refresh route --
// hoisted from the callback so no route can drift back to req.url.
export function publicOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host');
  if (forwardedHost !== null && forwardedHost.length > 0) {
    const proto = req.headers.get('x-forwarded-proto') ?? 'https';
    return proto + '://' + forwardedHost;
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
