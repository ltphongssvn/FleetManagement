// apps/ops-web/src/features/dispatch/export-orders-excel.action.ts
//
// T1 (2026): Server action that proxies the Lệnh điều xe Excel export
// through the ops-web BFF. Reads the JWT from the fleet_session httpOnly
// cookie (industry pattern: token never reaches client JS), calls the
// API's GET /transport-orders/export.xlsx, and returns the binary as a
// base64 string + suggested filename. The client component decodes and
// triggers a browser download from memory.
'use server';
import { cookies } from 'next/headers';
export type ExportOrdersExcelResult =
  | { status: 'ok'; bodyBase64: string; filename: string }
  | { status: 'auth_required' }
  | { status: 'server_error'; message: string };
const FILENAME_RE = /filename="([^"]+)"/;
function parseFilename(contentDisposition: string | null): string {
  if (contentDisposition === null) return 'lenh-dieu-xe.xlsx';
  const m = FILENAME_RE.exec(contentDisposition);
  return m?.[1] ?? 'lenh-dieu-xe.xlsx';
}
export async function exportOrdersExcel(): Promise<ExportOrdersExcelResult> {
  const apiUrl = process.env['FLEET_API_URL'];
  if (apiUrl === undefined || apiUrl.length === 0) {
    return { status: 'server_error', message: 'FLEET_API_URL not configured' };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get('fleet_session')?.value;
  if (token === undefined || token.length === 0) {
    return { status: 'auth_required' };
  }
  const res = await fetch(apiUrl + '/transport-orders-export.xlsx', {
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) {
    return { status: 'server_error', message: 'Export failed: ' + String(res.status) };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = parseFilename(res.headers.get('content-disposition'));
  return { status: 'ok', bodyBase64: buf.toString('base64'), filename };
}
