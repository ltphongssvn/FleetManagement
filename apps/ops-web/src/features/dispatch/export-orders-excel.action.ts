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
import { ExportQuerySchema, type ExportQuery } from '@fleet/sync-protocol';
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
export async function exportOrdersExcel(filter?: ExportQuery): Promise<ExportOrdersExcelResult> {
  const apiUrl = process.env['FLEET_API_URL'];
  if (apiUrl === undefined || apiUrl.length === 0) {
    return { status: 'server_error', message: 'Hệ thống chưa được cấu hình. Vui lòng liên hệ quản trị.' };
  }
  // T67: the export mirrors the dispatcher ACTIVE board view -- day range PLUS
  // free-text search term PLUS status tab, validated against the SSOT
  // ExportQuerySchema BEFORE the fetch so the query string cannot drift from
  // what the API accepts. Stable key order keeps the URL deterministic;
  // URLSearchParams does the percent-encoding, so Vietnamese diacritics survive
  // and dispatcher input is NEVER hand-concatenated into a URL. An absent or
  // empty filter sends NO query string, preserving daily-backup semantics.
  // Feature 4: optional dispatcher-selected inclusive day-range. Validate against
  // the SSOT before calling the API so an inverted/malformed range fails fast on
  // this side too (the API re-validates). Empty range => export everything.
  let querySuffix = '';
  if (filter !== undefined) {
    const parsed = ExportQuerySchema.safeParse(filter);
    if (!parsed.success) {
      return { status: 'server_error', message: 'Bộ lọc xuất Excel không hợp lệ' };
    }
    const qs = new URLSearchParams();
    if (parsed.data.from !== undefined) qs.set('from', parsed.data.from);
    if (parsed.data.to !== undefined) qs.set('to', parsed.data.to);
    if (parsed.data.search !== undefined) qs.set('search', parsed.data.search);
    if (parsed.data.group !== undefined) qs.set('group', parsed.data.group);
    const encoded = qs.toString();
    querySuffix = encoded === '' ? '' : '?' + encoded;
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
