// apps/driver-app/src/assignments/delivery-lifecycle-client.ts
// HTTP client for the driver delivery lifecycle:
//   POST /driver/assignments/:roadRunId/{accept,start,complete}
// Each transition is FSM-validated server-side; the new road_run state in
// the response is what the dispatcher's board also reads, so a successful
// accept() is the driver's acknowledgement back to the dispatcher.
export type FetchFn = typeof globalThis.fetch;
export interface DeliveryLifecycleClientConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly fetchFn?: FetchFn;
}
export interface TransitionResult {
  readonly roadRunId: string;
  readonly state: string;
}
type LifecycleAction = 'accept' | 'start' | 'complete';
function parseResult(raw: unknown): TransitionResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('TransitionResult: not an object');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['roadRunId'] !== 'string') {
    throw new Error('TransitionResult: roadRunId must be string');
  }
  if (typeof r['state'] !== 'string') {
    throw new Error('TransitionResult: state must be string');
  }
  return { roadRunId: r['roadRunId'], state: r['state'] };
}
export class DeliveryLifecycleClient {
  constructor(private readonly config: DeliveryLifecycleClientConfig) {}
  private async post(roadRunId: string, action: LifecycleAction): Promise<TransitionResult> {
    const token = await this.config.bearerToken();
    const fetchFn: FetchFn = this.config.fetchFn ?? globalThis.fetch;
    const url = `${this.config.apiUrl}/driver/assignments/${roadRunId}/${action}`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`POST ${url} HTTP ${String(res.status)} ${res.statusText}`);
    }
    const raw = (await res.json()) as unknown;
    return parseResult(raw);
  }
  accept(roadRunId: string): Promise<TransitionResult> {
    return this.post(roadRunId, 'accept');
  }
  start(roadRunId: string): Promise<TransitionResult> {
    return this.post(roadRunId, 'start');
  }
  complete(roadRunId: string): Promise<TransitionResult> {
    return this.post(roadRunId, 'complete');
  }
}
