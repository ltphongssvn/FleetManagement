// apps/ops-web/src/proxy.ts
// Auth middleware: gates protected routes behind the fleet_session cookie.
// Reads the httpOnly cookie set by the login server action.
//
// RSC prefetch loop guard (2026): a Next.js App Router <Link> prefetches its
// target as an RSC request. If we answer an unauthenticated RSC request with a
// 307 redirect to /login, Next.js drops the ?_rsc query param on the redirect,
// the router cannot consume an HTML redirect as an RSC payload, and it retries
// the prefetch in a tight loop until the browser runs out of sockets
// (net::ERR_INSUFFICIENT_RESOURCES). See vercel/next.js#79346 / #65783.
//
// Verified at runtime against Next 16: the 'Rsc' and 'Next-Router-Prefetch'
// request headers are STRIPPED before middleware runs and read back as null.
// The signal that survives is the Accept header — RSC requests send
// 'text/x-component', document requests send 'text/html'. So we discriminate
// on Accept: for RSC requests we REWRITE to /login (the router receives a
// valid RSC payload and navigates once); document requests keep the 307
// redirect so the address bar updates correctly.
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
