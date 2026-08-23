// apps/ops-web/src/app/api/reference/warehouses/[id]/route.ts
// BFF: rename (PATCH) + soft-delete (DELETE) for one warehouses row.
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { forwardWrite } from '@/app/api/_forward';
interface Ctx {
  params: Promise<{ id: string }>;
}
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forwardWrite(req, '/reference/warehouses/' + id, 'PATCH');
}
export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forwardWrite(req, '/reference/warehouses/' + id, 'DELETE');
}
