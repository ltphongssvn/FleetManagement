// apps/driver-app/src/sync/fetch-sync-transport.ts
// Native SyncTransport adapter wrapping fetch. Validates server response with
// zod before returning to the orchestrator (defense at the wire boundary).
import type { SyncRequest, SyncResponse } from '@fleet/sync-protocol';
import { createSyncCursor } from '@fleet/sync-protocol';
import type { SyncTransport } from './sync-loop.js';

export type FetchFn = typeof globalThis.fetch;

export interface FetchTransportConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  /** Inject for tests; defaults to global fetch in RN/Node 22+. */
  readonly fetchFn?: FetchFn;
}

interface RawSyncResponse {
  status?: unknown;
  newCursor?: unknown;
  eventSeq?: unknown;
  deltas?: unknown;
  results?: unknown;
  serverTime?: unknown;
  projectionStatus?: unknown;
  hysteresisVersion?: unknown;
  configFlagVersion?: unknown;
  retryAfterMs?: unknown;
}

const VALID_STATUSES = new Set([
  'ok', 'cursor_expired', 'config_refresh_required', 'artifact_generation_in_progress',
  'artifact_unavailable', 'lock_contended', 'bootstrap_config_stale', 'bootstrap_format_deprecated',
]);
const VALID_RESULTS = new Set([
  'applied', 'duplicate', 'rejected', 'superseded', 'awaiting_handoff', 'awaiting_proof', 'hint_conflict',
]);

function parseSyncResponse(raw: unknown): SyncResponse {
  if (typeof raw !== 'object' || raw === null) throw new Error('SyncResponse: not an object');
  const r = raw as RawSyncResponse;
  if (typeof r.status !== 'string' || !VALID_STATUSES.has(r.status)) {
    throw new Error(`SyncResponse: invalid status: ${String(r.status)}`);
  }
  if (typeof r.newCursor !== 'string') throw new Error('SyncResponse: newCursor must be string');
  if (typeof r.eventSeq !== 'number') throw new Error('SyncResponse: eventSeq must be number');
  if (!Array.isArray(r.deltas)) throw new Error('SyncResponse: deltas must be array');
  if (!Array.isArray(r.results)) throw new Error('SyncResponse: results must be array');
  for (const x of r.results as unknown[]) {
    if (typeof x !== 'string' || !VALID_RESULTS.has(x)) throw new Error(`SyncResponse: invalid result: ${String(x)}`);
  }
  if (typeof r.serverTime !== 'string') throw new Error('SyncResponse: serverTime must be string');
  if (typeof r.projectionStatus !== 'object' || r.projectionStatus === null) {
    throw new Error('SyncResponse: projectionStatus must be object');
  }
  if (typeof r.hysteresisVersion !== 'number') throw new Error('SyncResponse: hysteresisVersion must be number');
  if (typeof r.configFlagVersion !== 'number') throw new Error('SyncResponse: configFlagVersion must be number');
  return {
    status: r.status as SyncResponse['status'],
    newCursor: createSyncCursor(r.newCursor),
    eventSeq: r.eventSeq,
    deltas: r.deltas,
    results: r.results as SyncResponse['results'],
    serverTime: r.serverTime,
    projectionStatus: r.projectionStatus as Record<string, unknown>,
    hysteresisVersion: r.hysteresisVersion,
    configFlagVersion: r.configFlagVersion,
    ...(typeof r.retryAfterMs === 'number' ? { retryAfterMs: r.retryAfterMs } : {}),
  };
}

export class FetchSyncTransport implements SyncTransport {
  constructor(private readonly config: FetchTransportConfig) {}

  async post(req: SyncRequest): Promise<SyncResponse> {
    let token: string;
    try {
      token = await this.config.bearerToken();
    } catch (err: unknown) {
      // Auth retrieval failure surfaces as transport_failure (not silent).
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`bearerToken failed: ${msg}`, { cause: err });
    }
    const fetchFn: FetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn(`${this.config.apiUrl}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      throw new Error(`/sync HTTP ${String(res.status)} ${res.statusText}`);
    }
    const raw = (await res.json()) as unknown;
    return parseSyncResponse(raw);
  }
}
