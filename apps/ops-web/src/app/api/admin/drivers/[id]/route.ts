// apps/ops-web/src/app/api/admin/drivers/[id]/route.ts
// BFF: rename (PATCH) + soft-delete (DELETE) for one driver row. Attaches
// the fleet_session bearer (httpOnly cookie) server-side so it never reaches
// the browser. Body and status are forwarded verbatim from the API.
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
function getApiUrl(): string {
  return process.env['FLEET_API_URL'] ?? 'http://api:3000';
}
interface Ctx { params: Promise<{ id: string }> }
async function forward(req: NextRequest, id: string, method: 'PATCH' | 'DELETE'): Promise<NextResponse> {
  const token = (await cookies()).get('fleet_session')?.value;
  if (token === undefined) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const hasBody = method !== 'DELETE';
  const init: RequestInit = {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
  };
  if (hasBody) init.body = await req.text();
  const res = await fetch(getApiUrl() + '/admin/drivers/' + id, init);
  const body = await res.text();
  return new NextResponse(body, { status: res.status, headers: { 'content-type': 'application/json' } });
}
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forward(req, id, 'PATCH');
}
export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forward(req, id, 'DELETE');
}
