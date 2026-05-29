// apps/ops-web/src/app/api/admin/devices/route.ts
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
function getApiUrl(): string { return process.env['FLEET_API_URL'] ?? 'http://api:3000'; }
export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = (await cookies()).get('fleet_session')?.value;
  if (token === undefined) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = await req.text();
  const res = await fetch(`${getApiUrl()}/admin/devices`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  });
  return new NextResponse(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
}
