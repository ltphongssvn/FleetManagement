// apps/ops-web/src/proxy.ts
// Auth middleware: gates protected routes behind the fleet_session cookie.
//
// RSC prefetch loop guard: unauthenticated RSC requests get rewrite-to-/login
// (not 307) since Next.js drops ?_rsc on redirect and the router loops.
// Discriminator: Accept: text/x-component (RSC) vs text/html (document).
//
// Server Action carve-out (hotfix 2026): a Cancel/mutation click is a Server
// Action POST fired against the CURRENT protected route (e.g.
// /dispatch/orders/:id) and carries the Next-Action request header. Next.js
// CANNOT forward a proxy rewrite/redirect for a Server Action response, so
// diverting one to /login makes the action client receive the /login payload
// instead of an action result and throw 'An unexpected response was received
// from the server' (the route error boundary then shows 'Something went wrong').
// Proven live against production: such a POST returned HTTP 404 with
// x-nextjs-action-not-found:1 and x-middleware-rewrite:/login. Per Next.js 2026
// guidance (vercel/next.js #64993) and the May-2026 auth advisories, proxy.ts is
// a UX/redirect layer, NOT a security boundary (cf. CVE-2025-29927); Server
// Actions are public POST endpoints that MUST authenticate themselves. So we let
// Next-Action requests pass untouched and the action enforces auth (cancelOrder
// redirects an unauthenticated caller to /login).
import { NextResponse, type NextRequest } from 'next/server';
const PUBLIC_PATHS = new Set(['/login']);
const API_PREFIX = '/api/';
// problem+json body for unauthenticated API calls: /api/* is a JSON boundary;
// answering it with an HTML redirect made every client render
// "Unexpected token '<'" noise (3rd facet of the same proxy class after the
// RSC-loop and Server-Action carve-outs). The presenter maps UNAUTHORIZED to
// 'Phien dang nhap het han. Vui long dang nhap lai.'
const UNAUTHORIZED_PROBLEM = {
  type: 'about:blank',
  title: 'Unauthorized',
  status: 401,
  code: 'UNAUTHORIZED',
} as const;
const RSC_ACCEPT = 'text/x-component';
function isRscRequest(req: NextRequest): boolean {
  return req.headers.get('accept')?.includes(RSC_ACCEPT) ?? false;
}
function isServerAction(req: NextRequest): boolean {
  return req.headers.get('next-action') !== null;
}
export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  // Never divert a Server Action POST to /login (see file header): Next.js cannot
  // forward a rewrite/redirect for an action response. The action authenticates
  // itself and redirects unauthenticated callers to /login.
  if (isServerAction(req)) return NextResponse.next();
  const session = req.cookies.get('fleet_session')?.value;
  if (session !== undefined) return NextResponse.next();
  const refresh = req.cookies.get('fleet_refresh')?.value;
  if (pathname.startsWith(API_PREFIX)) {
    // Route handlers silently refresh when fleet_refresh exists; without it
    // the answer is 401 problem+json -- NEVER an HTML redirect.
    return refresh !== undefined
      ? NextResponse.next()
      : NextResponse.json(UNAUTHORIZED_PROBLEM, { status: 401 });
  }
  if (refresh !== undefined && !isRscRequest(req)) {
    // Page navigation with an expired access token but a live refresh token:
    // bounce through the refresh route, which re-mints fleet_session and
    // returns the dispatcher to where they were -- no /login mid-shift.
    const refreshUrl = new URL('/api/auth/refresh', req.url);
    refreshUrl.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(refreshUrl);
  }
  const loginUrl = new URL('/login', req.url);
  return isRscRequest(req)
    ? NextResponse.rewrite(loginUrl)
    : NextResponse.redirect(loginUrl);
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
