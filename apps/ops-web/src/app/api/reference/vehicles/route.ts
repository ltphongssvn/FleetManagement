// apps/ops-web/src/app/api/reference/vehicles/route.ts
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
function getApiUrl(): string { return process.env['FLEET_API_URL'] ?? 'http://api:3000'; }
export async function GET(): Promise<NextResponse> {
  const token = (await cookies()).get('fleet_session')?.value;
  if (token === undefined) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const res = await fetch(`${getApiUrl()}/reference/vehicles`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const body = await res.text();
  return new NextResponse(body, { status: res.status, headers: { 'content-type': 'application/json' } });
}
