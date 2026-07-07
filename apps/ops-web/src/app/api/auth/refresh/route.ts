// apps/ops-web/src/app/api/auth/refresh/route.ts
// Silent session refresh for PAGE navigations (the proxy bounces here when
// fleet_session expired but fleet_refresh survives). Exchanges the refresh
// token, sets the rotated pair ON THE REDIRECT RESPONSE (next/headers writes
// do not ride a separately-constructed redirect -- callback lesson), and
// returns the dispatcher to the page they asked for. Any failure clears both
// cookies and lands on /login?error=session_expired.
import { NextResponse, type NextRequest } from 'next/server';
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  refreshCookieOptions,
  refreshEnvFromProcess,
  refreshSession,
  sessionCookieOptions,
} from '@/features/auth/session-refresh';

function safeNext(raw: string | null): string {
  if (raw === null || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const nextPath = safeNext(new URL(req.url).searchParams.get('next'));
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  const env = refreshEnvFromProcess();
  const fail = (): NextResponse => {
    const res = NextResponse.redirect(new URL('/login?error=session_expired', req.url));
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  };
  if (refresh === undefined || env === null) return fail();
  const rotated = await refreshSession(refresh, env);
  if (rotated === null) return fail();
  const res = NextResponse.redirect(new URL(nextPath, req.url));
  res.cookies.set(SESSION_COOKIE, rotated.accessToken, sessionCookieOptions(rotated.expiresIn));
  res.cookies.set(REFRESH_COOKIE, rotated.refreshToken, refreshCookieOptions());
  return res;
}
