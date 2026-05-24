// apps/ops-web/src/app/api/reference/cargo-types/route.ts
// BFF: list (GET) + create (POST) for the cargo-types reference table.
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { forwardGet, forwardWrite } from '../_forward';
export function GET(): Promise<NextResponse> {
  return forwardGet('/reference/cargo-types');
}
export function POST(req: NextRequest): Promise<NextResponse> {
  return forwardWrite(req, '/reference/cargo-types', 'POST');
}
