// apps/ops-web/src/app/api/transport-orders/[id]/cancel/route.ts
// BFF: POST one transport order cancellation, forwarded to the API with
// the fleet_session bearer token. Mirrors the sibling GET route under
// [id]/route.ts: the shared forwardWrite helper attaches auth and proxies
// status + body verbatim so a 404/409 from the API stays a 404/409 on
// the BFF. The Playwright L0 acceptance spec drives this route.
import type { NextRequest, NextResponse } from 'next/server';
import { forwardWrite } from '@/app/api/_forward';
interface Ctx {
  params: Promise<{ id: string }>;
}
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forwardWrite(req, '/transport-orders/' + id + '/cancel', 'POST');
}
