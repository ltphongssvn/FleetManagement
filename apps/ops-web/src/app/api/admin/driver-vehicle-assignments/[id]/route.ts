// apps/ops-web/src/app/api/admin/driver-vehicle-assignments/[id]/route.ts
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getApiUrl } from '@/lib/api-url';


export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const token = (await cookies()).get('fleet_session')?.value;
  if (token === undefined) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.text();
  const res = await fetch(`${getApiUrl()}/admin/driver-vehicle-assignments/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  });
  const respBody = await res.text();
  return new NextResponse(respBody, { status: res.status, headers: { 'content-type': 'application/json' } });
}
