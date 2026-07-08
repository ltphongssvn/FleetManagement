// apps/ops-web/src/features/auth/session-refresh.ts
// Silent-refresh seam (2026 BFF pattern): the refresh token lives ONLY in an
// httpOnly cookie; this pure function exchanges it at the Keycloak token
// endpoint (grant_type=refresh_token, public client + PKCE-issued RT) and
// returns rotated tokens, or null on any failure (expired/revoked/offline/
// malformed) -- callers decide whether that means 401 JSON (api routes) or a
// /login redirect (page navigations). Cookie names + options are the single
// contract shared by the OIDC callback, the /api/auth/refresh route, and the
// BFF forwarder.
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

export interface RefreshEnv {
  readonly tokenEndpoint: string;
  readonly clientId: string;
}

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
  const tokenEndpoint = process.env['OIDC_TOKEN_ENDPOINT'];
  const clientId = process.env['OIDC_CLIENT_ID'];
  if (tokenEndpoint === undefined || clientId === undefined) return null;
  return { tokenEndpoint, clientId };
}
