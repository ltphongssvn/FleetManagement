// workers/main-worker/src/intake/intake-callback.ts
// Port: worker calls back to API with validated intake decision so the API can
// transition manifest+upload_session and emit manifest.committed to outbox.
// Frozen Stack PDF: API owns DB; worker is pure validator that reports back.
// 401 hook (phieu-photo-visibility arc, slice C): a 401 means the bearer
// credential was rejected -- the caller-supplied onUnauthorized (wired to
// KeycloakClientCredentialsTokenProvider.invalidate) drops the token cache
// BEFORE the throw, so the BullMQ at-least-once retry mints fresh. BullMQ is
// the outer retry-once; no inner retry loop duplicating the queue.
export interface IntakeCallback {
  /** POST /upload/intake-result. Throws on non-2xx so BullMQ retries. */
  finalize(input: {
    readonly uploadSessionId: string;
    readonly accepted: boolean;
    readonly rejectionReasonCode?: string;
  }): Promise<void>;
}
export interface FetchIntakeCallbackConfig {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly fetchFn?: typeof globalThis.fetch;
  /** Invoked exactly once when the API answers 401 (before the throw). */
  readonly onUnauthorized?: () => void;
}
export class FetchIntakeCallback implements IntakeCallback {
  constructor(private readonly config: FetchIntakeCallbackConfig) {}
  async finalize(input: {
    uploadSessionId: string;
    accepted: boolean;
    rejectionReasonCode?: string;
  }): Promise<void> {
    const token = await this.config.bearerToken();
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn(this.config.apiUrl + '/upload/intake-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      if (res.status === 401) {
        this.config.onUnauthorized?.();
      }
      throw new Error('intake-result HTTP ' + String(res.status) + ' ' + res.statusText);
    }
  }
}
