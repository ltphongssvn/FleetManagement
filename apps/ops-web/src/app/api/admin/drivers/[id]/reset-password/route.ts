// apps/ops-web/src/app/api/admin/drivers/[id]/reset-password/route.ts
// BFF: service-desk password reset (POST {newPassword}), riding the app-wide
// forwarder (mint-on-miss). The API answers 204 No Content on success; the
// forwarder passthrough forwards bodiless statuses verbatim (no body, no
// JSON content-type).
import { type NextRequest, type NextResponse } from 'next/server';
import { forwardWrite } from '@/app/api/_forward';

interface Ctx { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return forwardWrite(req, '/admin/drivers/' + id + '/reset-password', 'POST');
}
