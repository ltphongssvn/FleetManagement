// apps/ops-web/src/app/api/admin/drivers/route.ts
// BFF: forwards GET (list) and POST (create) /admin/drivers to backend
// with token from httpOnly cookie.
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

function getApiUrl(): string {
  return process.env['FLEET_API_URL'] ?? 'http://api:3000';
}

export async function GET(): Promise<NextResponse> {
  const token = (await cookies()).get('fleet_session')?.value;
  if (token === undefined) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const res = await fetch(`${getApiUrl()}/admin/drivers`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const body = await res.text();
  return new NextResponse(body, { status: res.status, headers: { 'content-type': 'application/json' } });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = (await cookies()).get('fleet_session')?.value;
  if (token === undefined) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = await req.text();
  const res = await fetch(`${getApiUrl()}/admin/drivers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  });
  const respBody = await res.text();
  return new NextResponse(respBody, { status: res.status, headers: { 'content-type': 'application/json' } });
}
