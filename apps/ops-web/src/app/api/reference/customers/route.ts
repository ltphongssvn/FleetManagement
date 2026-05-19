// apps/ops-web/src/app/api/reference/customers/route.ts
// BFF: list (GET) + create (POST) for the customers reference table.
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { forwardGet, forwardWrite } from '../_forward';
export function GET(): Promise<NextResponse> {
  return forwardGet('/reference/customers');
}
export function POST(req: NextRequest): Promise<NextResponse> {
  return forwardWrite(req, '/reference/customers', 'POST');
}
