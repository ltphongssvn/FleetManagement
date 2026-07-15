// apps/ops-web/src/app/api/admin/driver-vehicle-assignments/route.ts
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getApiUrl } from '@/lib/api-url';


export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = (await cookies()).get('fleet_session')?.value;
  if (token === undefined) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = await req.text();
  const res = await fetch(`${getApiUrl()}/admin/driver-vehicle-assignments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  });
  const respBody = await res.text();
  return new NextResponse(respBody, { status: res.status, headers: { 'content-type': 'application/json' } });
}
