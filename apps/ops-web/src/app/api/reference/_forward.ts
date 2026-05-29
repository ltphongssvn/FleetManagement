// apps/ops-web/src/app/api/reference/_forward.ts
// Shared BFF forwarder for reference master-data routes. Each route file is a
// thin wrapper that names its backend path; this helper attaches the
// fleet_session bearer token (httpOnly cookie, never exposed to the browser)
// and proxies the request/response verbatim. Keeps the 8 reference CRUD
// route files free of duplicated auth + fetch boilerplate.
//
// T5c: forwardGet preserves the incoming request's query string so the
// admin page can opt into ?scope=admin (returns all active rows, bypassing
// the dispatch create-order form's pair-filtered subset).
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
function getApiUrl(): string {
  return process.env['FLEET_API_URL'] ?? 'http://api:3000';
}
async function token(): Promise<string | undefined> {
  return (await cookies()).get('fleet_session')?.value;
}
function passthrough(res: Response, body: string): NextResponse {
  return new NextResponse(body, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
export async function forwardGet(path: string, req?: NextRequest): Promise<NextResponse> {
  const t = await token();
  if (t === undefined) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const qs = req !== undefined ? new URL(req.url).search : '';
  const res = await fetch(getApiUrl() + path + qs, {
    headers: { Authorization: 'Bearer ' + t },
    cache: 'no-store',
  });
  return passthrough(res, await res.text());
}
export async function forwardWrite(
  req: NextRequest,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
): Promise<NextResponse> {
  const t = await token();
  if (t === undefined) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const hasBody = method !== 'DELETE';
  const init: RequestInit = {
    method,
    headers: {
      Authorization: 'Bearer ' + t,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
  };
  if (hasBody) init.body = await req.text();
  const res = await fetch(getApiUrl() + path, init);
  return passthrough(res, await res.text());
}
