// apps/ops-web/src/app/api/reference/vehicles/route.ts
// BFF: list (GET) + create (POST) for the vehicles reference table.
// T5c: GET forwards the request so query params (e.g. ?scope=admin) reach
// the API.
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { forwardGet, forwardWrite } from '@/app/api/_forward';
export function GET(req: NextRequest): Promise<NextResponse> {
  return forwardGet('/reference/vehicles', req);
}
export function POST(req: NextRequest): Promise<NextResponse> {
  return forwardWrite(req, '/reference/vehicles', 'POST');
}
