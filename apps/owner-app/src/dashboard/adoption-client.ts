// apps/owner-app/src/dashboard/adoption-client.ts
// HTTP client for the owner adoption dashboard. Calls GET
// /owner/metrics/adoption with a bearer token and validates the response at
// the trust boundary against the @fleet/sync-protocol OwnerAdoptionMetrics
// SSOT (single safeParse; no re-typing). fetch + token provider are injected
// so the client is a pure, deterministic unit (mirrors driver-app
// config-client.ts). The API scopes every count to the JWT operator's company,
// so no query parameters are sent.
import { OwnerAdoptionMetricsSchema, type OwnerAdoptionMetrics } from '@fleet/sync-protocol';

export interface FetchAdoptionOptions {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly fetchFn?: typeof globalThis.fetch;
}

export async function fetchAdoptionMetrics(opts: FetchAdoptionOptions): Promise<OwnerAdoptionMetrics> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const token = await opts.bearerToken();
  const res = await fetchFn(opts.apiUrl + '/owner/metrics/adoption', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) {
    throw new Error('/owner/metrics/adoption HTTP ' + String(res.status) + ' ' + res.statusText);
  }
  const raw = (await res.json()) as unknown;
  const parsed = OwnerAdoptionMetricsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('/owner/metrics/adoption invalid shape: ' + parsed.error.message);
  }
  return parsed.data;
}
