// apps/ops-web/src/app/api/admin/driver-vehicle-assignments/[id]/route.ts
// BFF: revoke one driver-vehicle assignment (DELETE with {reason} JSON body
// for the audit trail), riding the app-wide forwarder -- which preserves
// DELETE bodies because body presence is decided by the actual payload.
import { type NextRequest, type NextResponse } from 'next/server';
import { forwardWrite } from '@/app/api/_forward';

interface Ctx { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forwardWrite(req, '/admin/driver-vehicle-assignments/' + id, 'DELETE');
}
