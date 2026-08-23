// apps/ops-web/src/app/api/admin/drivers/[id]/route.ts
// BFF: rename (PATCH) + soft-delete (DELETE) for one driver row, riding the
// app-wide forwarder (mint-on-miss silent session re-mint; 401 problem+json
// only when no refresh is possible). PATCH carries a JSON body; DELETE is
// bodyless -- the forwarder decides by actual payload, not verb.
import { type NextRequest, type NextResponse } from 'next/server';
import { forwardWrite } from '@/app/api/_forward';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forwardWrite(req, '/admin/drivers/' + id, 'PATCH');
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forwardWrite(req, '/admin/drivers/' + id, 'DELETE');
}
