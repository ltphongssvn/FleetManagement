// apps/ops-web/src/app/api/admin/devices/route.ts
// BFF: device enrollment (POST), riding the app-wide forwarder
// (mint-on-miss silent session re-mint; 401 problem+json when no refresh
// is possible).
import { type NextRequest, type NextResponse } from 'next/server';
import { forwardWrite } from '@/app/api/_forward';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return forwardWrite(req, '/admin/devices', 'POST');
}
