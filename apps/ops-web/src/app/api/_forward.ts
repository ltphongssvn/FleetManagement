// apps/ops-web/src/app/api/_forward.ts
// App-wide BFF forwarder for ALL ops-web API route families. Attaches
// the fleet_session bearer (httpOnly, never exposed to the browser) and
// proxies verbatim. When the access token is missing/expired but a
// fleet_refresh cookie survives, it SILENTLY re-mints the session at the
// token endpoint and rides the rotated pair on the passthrough response --
// dispatchers never see a mid-shift 401 for an expired hour-token. Only when
// no refresh is possible does it answer 401 problem+json (code UNAUTHORIZED),
// which the presenter maps to 'Phien dang nhap het han...'.
//
// T5c: forwardGet preserves the incoming query string so the admin page can
// opt into ?scope=admin.
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getApiUrl } from '@/lib/api-url';
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  refreshCookieOptions,
  refreshEnvFromProcess,
  refreshSession,
  sessionCookieOptions,
  type RefreshedTokens,
} from '@/features/auth/session-refresh';


const UNAUTHORIZED_PROBLEM = {
  type: 'about:blank',
  title: 'Unauthorized',
  status: 401,
  code: 'UNAUTHORIZED',
} as const;

interface Bearer {
  readonly token: string;
  readonly rotated: RefreshedTokens | null;
}

async function bearer(): Promise<Bearer | null> {
  const store = await cookies();
  const session = store.get(SESSION_COOKIE)?.value;
  if (session !== undefined) return { token: session, rotated: null };
  const refresh = store.get(REFRESH_COOKIE)?.value;
  const env = refreshEnvFromProcess();
  if (refresh === undefined || env === null) return null;
  const rotated = await refreshSession(refresh, env);
  if (rotated === null) return null;
  return { token: rotated.accessToken, rotated };
}

function passthrough(res: Response, body: string, rotated: RefreshedTokens | null): NextResponse {
  // 204/205/304 -- and any empty body -- must not carry a body or a JSON
  // content-type: new NextResponse(body, ...) THROWS on null-body statuses,
  // and reset-password forwards the API's 204 No Content verbatim.
  const bodiless =
    res.status === 204 || res.status === 205 || res.status === 304 || body.length === 0;
  const out = bodiless
    ? new NextResponse(null, { status: res.status })
    : new NextResponse(body, {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
  if (rotated !== null) {
    out.cookies.set(SESSION_COOKIE, rotated.accessToken, sessionCookieOptions(rotated.expiresIn));
    out.cookies.set(REFRESH_COOKIE, rotated.refreshToken, refreshCookieOptions());
  }
  return out;
}

export async function forwardGet(path: string, req?: NextRequest): Promise<NextResponse> {
  const b = await bearer();
  if (b === null) return NextResponse.json(UNAUTHORIZED_PROBLEM, { status: 401 });
  const qs = req !== undefined ? new URL(req.url).search : '';
  const res = await fetch(getApiUrl() + path + qs, {
    headers: { Authorization: 'Bearer ' + b.token },
    cache: 'no-store',
  });
  return passthrough(res, await res.text(), b.rotated);
}

export async function forwardWrite(
  req: NextRequest,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
): Promise<NextResponse> {
  const b = await bearer();
  if (b === null) return NextResponse.json(UNAUTHORIZED_PROBLEM, { status: 401 });
  // Body presence is decided by the ACTUAL payload, not the verb: revoke()
  // sends {reason} in a DELETE body (audit trail) that must not be silently
  // dropped, while bodyless DELETE (drivers remove) stays legal. Empty
  // payloads carry neither a body nor a JSON content-type.
  const payload = await req.text();
  const hasBody = payload.length > 0;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: 'Bearer ' + b.token,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
  };
  if (hasBody) init.body = payload;
  const res = await fetch(getApiUrl() + path, init);
  return passthrough(res, await res.text(), b.rotated);
}
