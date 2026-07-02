// apps/driver-app/src/assignments/assignments-client.ts
// HTTP client for the driver transport-order reads:
//   GET /transport-orders/assigned     -> list()        : current assignments
//   GET /transport-orders/trip-history -> tripHistory()  : completed runs,
//     pre-grouped by VN-timezone month server-side (shared @fleet/domain
//     helper) so web and mobile agree on month boundaries.
// Both validate the wire shape at the boundary.
//
// Multi-stop parity (2026): the Lệnh điều xe - Tải thùng dispatch form creates
// 1..N pickup warehouses + a delivery (multi-stop). The API ListAssignedRow
// carries the full stops[] array; the mobile client preserves every stop in
// sequence so the driver app workflow is a 1-1 match with the form. The legacy
// pickupName/deliveryName remain (first pickup / last drop) for backward
// compatibility, but stops[] is the authoritative ordered list.
import { DriverCompletedPageResponseSchema } from '@fleet/sync-protocol';
import type { DriverCompletedPageQuery, DriverCompletedPageResponse } from '@fleet/sync-protocol';
export type FetchFn = typeof globalThis.fetch;
export interface StopRow {
  readonly sequence: number;
  readonly stopType: string;
  readonly plannedAt: string | null;
  readonly warehouseName: string | null;
  readonly arrivedAt: string | null;
  readonly departedAt: string | null;
}
export interface AssignmentRow {
  readonly transportOrderId: string;
  readonly roadRunId: string;
  readonly state: string;
  readonly plannedStartAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly plate: string | null;
  readonly orderRef: string | null;
  readonly customerName: string | null;
  readonly pickupName: string | null;
  readonly deliveryName: string | null;
  readonly stops: readonly StopRow[];
}
// A month bucket as returned by GET /transport-orders/trip-history.
export interface TripHistoryMonth {
  readonly monthKey: string;
  readonly label: string;
  readonly count: number;
  readonly trips: readonly AssignmentRow[];
}
export interface AssignmentsClientConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly fetchFn?: FetchFn;
}
function nullableStr(v: unknown, name: string): string | null {
  if (v === null) return null;
  if (typeof v === 'string') return v;
  throw new Error('AssignmentRow: ' + name + ' must be string|null');
}
function parseStop(raw: unknown): StopRow {
  if (typeof raw !== 'object' || raw === null) throw new Error('StopRow: not an object');
  const s = raw as Record<string, unknown>;
  if (typeof s['sequence'] !== 'number') throw new Error('StopRow: sequence must be number');
  if (typeof s['stopType'] !== 'string') throw new Error('StopRow: stopType must be string');
  return {
    sequence: s['sequence'],
    stopType: s['stopType'],
    plannedAt: nullableStr(s['plannedAt'], 'plannedAt'),
    warehouseName: nullableStr(s['warehouseName'], 'warehouseName'),
    arrivedAt: nullableStr(s['arrivedAt'], 'arrivedAt'),
    departedAt: nullableStr(s['departedAt'], 'departedAt'),
  };
}
function parseRow(raw: unknown): AssignmentRow {
  if (typeof raw !== 'object' || raw === null) throw new Error('AssignmentRow: not an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['transportOrderId'] !== 'string') throw new Error('AssignmentRow: transportOrderId must be string');
  if (typeof r['roadRunId'] !== 'string') throw new Error('AssignmentRow: roadRunId must be string');
  if (typeof r['state'] !== 'string') throw new Error('AssignmentRow: state must be string');
  const rawStops = r['stops'];
  let stops: readonly StopRow[] = [];
  if (rawStops !== undefined) {
    if (!Array.isArray(rawStops)) throw new Error('AssignmentRow: stops must be array');
    stops = rawStops.map(parseStop);
  }
  return {
    transportOrderId: r['transportOrderId'],
    roadRunId: r['roadRunId'],
    state: r['state'],
    plannedStartAt: nullableStr(r['plannedStartAt'], 'plannedStartAt'),
    startedAt: nullableStr(r['startedAt'], 'startedAt'),
    completedAt: nullableStr(r['completedAt'], 'completedAt'),
    plate: nullableStr(r['plate'], 'plate'),
    orderRef: nullableStr(r['orderRef'], 'orderRef'),
    customerName: nullableStr(r['customerName'], 'customerName'),
    pickupName: nullableStr(r['pickupName'], 'pickupName'),
    deliveryName: nullableStr(r['deliveryName'], 'deliveryName'),
    stops,
  };
}
function parseMonth(raw: unknown): TripHistoryMonth {
  if (typeof raw !== 'object' || raw === null) throw new Error('TripHistoryMonth: not an object');
  const m = raw as Record<string, unknown>;
  if (typeof m['monthKey'] !== 'string') throw new Error('TripHistoryMonth: monthKey must be string');
  if (typeof m['label'] !== 'string') throw new Error('TripHistoryMonth: label must be string');
  if (typeof m['count'] !== 'number') throw new Error('TripHistoryMonth: count must be number');
  if (!Array.isArray(m['trips'])) throw new Error('TripHistoryMonth: trips must be array');
  return {
    monthKey: m['monthKey'],
    label: m['label'],
    count: m['count'],
    trips: m['trips'].map(parseRow),
  };
}
export class AssignmentsClient {
  constructor(private readonly config: AssignmentsClientConfig) {}
  private async getJson(path: string): Promise<unknown> {
    const token = await this.config.bearerToken();
    const fetchFn: FetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn(this.config.apiUrl + path, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) {
      throw new Error(path + ' HTTP ' + String(res.status) + ' ' + res.statusText);
    }
    return (await res.json()) as unknown;
  }
  async list(): Promise<readonly AssignmentRow[]> {
    const raw = await this.getJson('/transport-orders/assigned');
    if (typeof raw !== 'object' || raw === null) throw new Error('Response: not an object');
    const rows = (raw as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) throw new Error('Response: rows must be array');
    return rows.map(parseRow);
  }
  async tripHistory(): Promise<readonly TripHistoryMonth[]> {
    const raw = await this.getJson('/transport-orders/trip-history');
    if (typeof raw !== 'object' || raw === null) throw new Error('Response: not an object');
    const months = (raw as { months?: unknown }).months;
    if (!Array.isArray(months)) throw new Error('Response: months must be array');
    return months.map(parseMonth);
  }

  // Paginated + searchable archive of the driver's COMPLETED runs. Builds the
  // query string from the SSOT query shape (page/pageSize + optional search),
  // then parses the response envelope through DriverCompletedPageResponseSchema
  // at the trust boundary (schema-first: ONE contract validates the wire, and
  // the return type is z.infer of that same schema). Unlike list()/tripHistory()
  // this read has no hand-rolled parser -- the shared contract IS the parser.
  async completed(query: DriverCompletedPageQuery): Promise<DriverCompletedPageResponse> {
    const params = new URLSearchParams();
    params.set('page', String(query.page));
    params.set('pageSize', String(query.pageSize));
    if (query.search !== undefined) params.set('search', query.search);
    const raw = await this.getJson('/transport-orders/completed?' + params.toString());
    return DriverCompletedPageResponseSchema.parse(raw);
  }
}
