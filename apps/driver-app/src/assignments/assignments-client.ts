// apps/driver-app/src/assignments/assignments-client.ts
// HTTP client for GET /transport-orders/assigned. Validates wire-shape at boundary.
export type FetchFn = typeof globalThis.fetch;

export interface AssignmentRow {
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
}

export interface AssignmentsClientConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly fetchFn?: FetchFn;
}

function parseRow(raw: unknown): AssignmentRow {
  if (typeof raw !== 'object' || raw === null) throw new Error('AssignmentRow: not an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['roadRunId'] !== 'string') throw new Error('AssignmentRow: roadRunId must be string');
  if (typeof r['state'] !== 'string') throw new Error('AssignmentRow: state must be string');
  const nullableStr = (v: unknown, name: string): string | null => {
    if (v === null) return null;
    if (typeof v === 'string') return v;
    throw new Error(`AssignmentRow: ${name} must be string|null`);
  };
  return {
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
  };
}

export class AssignmentsClient {
  constructor(private readonly config: AssignmentsClientConfig) {}

  async list(): Promise<readonly AssignmentRow[]> {
    const token = await this.config.bearerToken();
    const fetchFn: FetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn(`${this.config.apiUrl}/transport-orders/assigned`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`/transport-orders/assigned HTTP ${String(res.status)} ${res.statusText}`);
    }
    const raw = (await res.json()) as unknown;
    if (typeof raw !== 'object' || raw === null) throw new Error('Response: not an object');
    const rows = (raw as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) throw new Error('Response: rows must be array');
    return rows.map(parseRow);
  }
}
