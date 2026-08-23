// apps/ops-web/src/app/api/admin/devices/[deviceId]/binding/route.ts
// BFF: PATCH /admin/devices/:deviceId/binding (activate | revoke), riding the
// app-wide _forward helper (mint-on-miss silent session re-mint; 401 problem+json
// only when no refresh is possible). PATCH carries a JSON body ({action, and for
// revoke a revokedReason}); the forwarder decides body presence by actual payload,
// not verb. The route defines no shapes and re-validates nothing: the API parses
// the body via the strict DeviceBindingPatchRequestSchema and the :deviceId param
// as a guid (Axis 1, done once at the API boundary).
import { type NextRequest, type NextResponse } from 'next/server';
import { forwardWrite } from '@/app/api/_forward';

interface Ctx {
  params: Promise<{ deviceId: string }>;
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { deviceId } = await ctx.params;
  return forwardWrite(req, '/admin/devices/' + deviceId + '/binding', 'PATCH');
}
