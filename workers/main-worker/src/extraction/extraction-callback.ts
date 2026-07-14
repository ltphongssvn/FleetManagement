// workers/main-worker/src/extraction/extraction-callback.ts
// Port: worker reports the extraction result to the API so it can persist kg
// and emit manifest.net_weight_extracted. Mirrors intake-callback.ts, but the
// request body is the SSOT ExtractionResultWire -- built and parsed from the
// SAME schema on both sides of the boundary.
// 401 hook (phieu-photo-visibility arc, slice C): mirrors intake-callback --
// onUnauthorized (wired to the token provider invalidate) fires BEFORE the
// throw so the BullMQ retry mints a fresh client-credentials token.
import { ExtractionResultWireSchema, type ExtractionResultWire } from '@fleet/sync-protocol';
export interface ExtractionCallback {
  /** POST /upload/extraction-result. Throws on non-2xx so BullMQ retries. */
  finalize(input: ExtractionResultWire): Promise<void>;
}
export interface FetchExtractionCallbackConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly fetchFn?: typeof globalThis.fetch;
  /** Invoked exactly once when the API answers 401 (before the throw). */
  readonly onUnauthorized?: () => void;
}
export class FetchExtractionCallback implements ExtractionCallback {
  constructor(private readonly config: FetchExtractionCallbackConfig) {}
  async finalize(input: ExtractionResultWire): Promise<void> {
    const body = ExtractionResultWireSchema.parse(input);
    const token = await this.config.bearerToken();
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn(this.config.apiUrl + '/upload/extraction-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 401) {
        this.config.onUnauthorized?.();
      }
      throw new Error('extraction-result HTTP ' + String(res.status) + ' ' + res.statusText);
    }
  }
}
