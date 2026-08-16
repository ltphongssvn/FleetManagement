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
import {
  DriverCompletedPageResponseSchema,
  ListAssignedResponseSchema,
  TripHistoryResponseSchema,
} from '@fleet/sync-protocol';
import type {
  DriverCompletedPageQuery,
  DriverCompletedPageResponse,
  ListAssignedRow,
  ListAssignedRowStop,
  TripHistoryMonth,
} from '@fleet/sync-protocol';

export type FetchFn = typeof globalThis.fetch;

// Re-exported for back-compat with existing call sites (completed.tsx, the
// stops test). These are now the CONTRACT types, not local re-declarations:
// StopRow / AssignmentRow / TripHistoryMonth were hand-written here alongside
// ~60 lines of parseStop/parseRow/parseMonth while list-assigned-contract.ts
// already defined every one of those shapes. Two definitions of one wire
// contract, free to drift -- and it HAD drifted: parseRow silently dropped
// externalRef, createdAt, cargoName, driverName, canCancel and
// cancelBlockedReason, and parseMonth accepted a negative count because it
// checked only typeof number. canCancel is the server-computed cancel
// affordance the client is meant never to re-derive; the mobile client could
// not even see it.
export type StopRow = ListAssignedRowStop;
export type AssignmentRow = ListAssignedRow;
export type { TripHistoryMonth };

export interface AssignmentsClientConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly fetchFn?: FetchFn;
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
  // Both reads parse the ENVELOPE through the shared contract at the trust
  // boundary, exactly as completed() below already did. The schema validates
  // the wrapper and every row in one pass, so a malformed response still
  // throws -- the behaviour the hand-rolled guards provided -- while the six
  // fields they dropped now survive.
  async list(): Promise<readonly AssignmentRow[]> {
    const raw = await this.getJson('/transport-orders/assigned');
    return ListAssignedResponseSchema.parse(raw).rows;
  }
  async tripHistory(): Promise<readonly TripHistoryMonth[]> {
    const raw = await this.getJson('/transport-orders/trip-history');
    return TripHistoryResponseSchema.parse(raw).months;
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
