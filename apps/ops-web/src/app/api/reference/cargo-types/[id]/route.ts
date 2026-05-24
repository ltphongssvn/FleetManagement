// apps/ops-web/src/app/api/reference/cargo-types/[id]/route.ts
// BFF: rename (PATCH) + soft-delete (DELETE) for one cargo-types row.
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { forwardWrite } from '../../_forward';
interface Ctx { params: Promise<{ id: string }> }
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forwardWrite(req, '/reference/cargo-types/' + id, 'PATCH');
}
export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forwardWrite(req, '/reference/cargo-types/' + id, 'DELETE');
}
