// apps/ops-web/src/middleware.ts
// Auth middleware: redirects unauthenticated users to /login.
// Reads fleet_session httpOnly cookie set by login server action.
import { NextResponse, type NextRequest } from 'next/server';
const PUBLIC_PATHS = new Set(['/login']);
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  const session = req.cookies.get('fleet_session')?.value;
  if (!session) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
