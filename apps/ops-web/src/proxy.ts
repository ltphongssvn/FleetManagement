// apps/ops-web/src/proxy.ts
// Auth middleware: gates protected routes behind the fleet_session cookie.
// RSC prefetch loop guard: unauthenticated RSC requests get rewrite-to-/login
// (not 307) since Next.js drops ?_rsc on redirect and the router loops.
// Discriminator: Accept: text/x-component (RSC) vs text/html (document).
import { NextResponse, type NextRequest } from 'next/server';
const PUBLIC_PATHS = new Set(['/login']);
const RSC_ACCEPT = 'text/x-component';
function isRscRequest(req: NextRequest): boolean {
  return req.headers.get('accept')?.includes(RSC_ACCEPT) ?? false;
}
export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  const session = req.cookies.get('fleet_session')?.value;
  if (!session) {
    const loginUrl = new URL('/login', req.url);
    return isRscRequest(req)
      ? NextResponse.rewrite(loginUrl)
      : NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}
export const config = {
  // Exclude /api/auth/* from the matcher: the OAuth Authorization Code + PKCE
  // callback (/api/auth/callback) MUST run its route handler while the user is
  // still unauthenticated -- that handler is what exchanges the code and SETS
  // fleet_session. If the proxy matched it, it would see no fleet_session yet and
  // redirect to /login BEFORE the handler runs, so the token exchange never
  // happens, no Set-Cookie is emitted, and login can never complete (the request
  // bounces to a bare /login with the transient PKCE cookies still set). Auth
  // endpoints are their own trust boundary and validate state/PKCE themselves.
  // _next/static, _next/image, favicon.ico, and the health probe stay excluded.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|api/auth).*)'],
};
