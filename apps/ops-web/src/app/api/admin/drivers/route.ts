// apps/ops-web/src/app/api/admin/drivers/route.ts
// BFF: GET (list) and POST (create) /admin/drivers, riding the app-wide
// forwarder so an idle-expired hour-token is silently re-minted from the
// httpOnly fleet_refresh cookie (mint-on-miss) instead of surfacing a raw 401
// (prod evidence 2026-07-11: idle Quan ly tai xe & xe page died with
// Loi: load failed). 401 problem+json (code UNAUTHORIZED) only when no
// refresh is possible.
import { type NextRequest, type NextResponse } from 'next/server';
import { forwardGet, forwardWrite } from '@/app/api/_forward';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return forwardGet('/admin/drivers', req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return forwardWrite(req, '/admin/drivers', 'POST');
}
