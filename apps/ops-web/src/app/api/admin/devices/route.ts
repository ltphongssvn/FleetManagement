// apps/ops-web/src/app/api/admin/devices/route.ts
// BFF: GET (list) /admin/devices, riding the app-wide _forward helper so an
// idle-expired hour-token is silently re-minted from the httpOnly fleet_refresh
// cookie (mint-on-miss) instead of surfacing a raw 401. forwardGet preserves the
// incoming query string, so the status/page/pageSize filter reaches the paginated
// API endpoint verbatim. The route defines no shapes and re-validates nothing:
// the API validates the request query (Axis 1); the client validates the response
// on read (Axis 1). A proxy that re-parsed here would be redundant validation.
import { type NextRequest, type NextResponse } from 'next/server';
import { forwardGet } from '@/app/api/_forward';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return forwardGet('/admin/devices', req);
}
