// apps/ops-web/src/app/api/reference/warehouses/route.ts
// BFF: list (GET) + create (POST) for the warehouses reference table.
// GET forwards the optional ?role query param so pickup and delivery
// warehouses can be listed separately.
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { forwardGet, forwardWrite } from '@/app/api/_forward';
export function GET(req: NextRequest): Promise<NextResponse> {
  const role = req.nextUrl.searchParams.get('role');
  const path = role === null ? '/reference/warehouses' : '/reference/warehouses?role=' + role;
  return forwardGet(path);
}
export function POST(req: NextRequest): Promise<NextResponse> {
  return forwardWrite(req, '/reference/warehouses', 'POST');
}
