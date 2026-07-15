// apps/ops-web/src/app/api/admin/drivers/[id]/reset-password/route.ts
// BFF: service-desk password reset (POST) for one driver row. Attaches the
// fleet_session bearer (httpOnly cookie) server-side so it never reaches the
// browser. Body ({newPassword}) and status are forwarded verbatim from the API
// (204 on success). Mirrors the sibling [id]/route.ts proxy.
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getApiUrl } from '@/lib/api-url';
interface Ctx { params: Promise<{ id: string }> }
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const token = (await cookies()).get('fleet_session')?.value;
  if (token === undefined) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const init: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: await req.text(),
  };
  const res = await fetch(getApiUrl() + '/admin/drivers/' + id + '/reset-password', init);
  // The API returns 204 No Content on success (empty body). Forward the status
  // verbatim; only attach a JSON content-type when there is a body to parse.
  const body = await res.text();
  if (body.length === 0) return new NextResponse(null, { status: res.status });
  return new NextResponse(body, { status: res.status, headers: { 'content-type': 'application/json' } });
}
