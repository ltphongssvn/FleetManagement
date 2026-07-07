// apps/ops-web/src/app/api/copilot/execute/route.ts
// BFF: forward the dispatcher-confirmed plan to the api copilot executor.
// Reuses the shared reference forwarder (one forwarding SSOT).
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { forwardWrite } from '../../reference/_forward';

export function POST(req: NextRequest): Promise<NextResponse> {
  return forwardWrite(req, '/copilot/execute', 'POST');
}
