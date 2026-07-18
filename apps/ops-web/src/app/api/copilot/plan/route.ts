// apps/ops-web/src/app/api/copilot/plan/route.ts
// BFF: forward the command palette's plan request (free text) to the api
// copilot planner. Reuses the shared reference forwarder (one forwarding
// SSOT; it attaches the httpOnly fleet_session bearer and proxies verbatim).
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { forwardWrite } from '@/app/api/_forward';

export function POST(req: NextRequest): Promise<NextResponse> {
  return forwardWrite(req, '/copilot/plan', 'POST');
}
