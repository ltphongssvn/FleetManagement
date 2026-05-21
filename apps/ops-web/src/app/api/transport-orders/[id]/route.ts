// apps/ops-web/src/app/api/transport-orders/[id]/route.ts
// BFF: GET one transport order by id, forwarded to the API with the
// fleet_session bearer token. Mirrors the reference/* BFF pattern: the
// shared _forward helper attaches auth and proxies status + body verbatim
// so a 404 from the API stays a 404 on the BFF.
import type { NextResponse } from 'next/server';
import { forwardGet } from '../../reference/_forward';
interface Ctx { params: Promise<{ id: string }> }
export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forwardGet('/transport-orders/' + id);
}
