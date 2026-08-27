// apps/ops-web/src/features/dispatch/export-orders-excel.action.ts
//
// T1 (2026): Server action that proxies the Lệnh điều xe Excel export
// through the ops-web BFF. Reads the JWT from the fleet_session httpOnly
// cookie (industry pattern: token never reaches client JS), calls the
// API's GET /transport-orders/export.xlsx, and returns the binary as a
// base64 string + suggested filename. The client component decodes and
// triggers a browser download from memory.
'use server';
import { vnApiErrorMessage } from '../errors/present-problem';
import { cookies } from 'next/headers';
import { ExportDateRangeSchema, type ExportDateRange } from '@fleet/sync-protocol';
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
export async function exportOrdersExcel(range?: ExportDateRange): Promise<ExportOrdersExcelResult> {
  const apiUrl = process.env['FLEET_API_URL'];
  if (apiUrl === undefined || apiUrl.length === 0) {
    return {
      status: 'server_error',
      message: 'Hệ thống chưa được cấu hình. Vui lòng liên hệ quản trị.',
    };
  }
  // Feature 4: optional dispatcher-selected inclusive day-range. Validate against
  // the SSOT before calling the API so an inverted/malformed range fails fast on
  // this side too (the API re-validates). Empty range => export everything.
  let querySuffix = '';
  if (range !== undefined) {
    const parsed = ExportDateRangeSchema.safeParse(range);
    if (!parsed.success) {
      return { status: 'server_error', message: 'Khoảng ngày không hợp lệ' };
    }
    querySuffix = '?from=' + parsed.data.from + '&to=' + parsed.data.to;
  }
  const cookieStore = await cookies();
  const token = cookieStore.get('fleet_session')?.value;
  if (token === undefined || token.length === 0) {
    return { status: 'auth_required' };
  }
  const res = await fetch(apiUrl + '/transport-orders-export.xlsx' + querySuffix, {
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) {
    const errBody: unknown = await res.json().catch(() => undefined);
    return { status: 'server_error', message: vnApiErrorMessage(res.status, errBody) };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = parseFilename(res.headers.get('content-disposition'));
  return { status: 'ok', bodyBase64: buf.toString('base64'), filename };
}
