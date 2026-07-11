// workers/main-worker/src/auth/keycloak-token-provider.ts
// OAuth2 client-credentials token provider (RFC 6749 section 4.4) for the
// worker -> API callback seam. Replaces the static FLEET_API_TOKEN whose
// silent expiry stalled 65 manifests in verifying from Jun-24 (see
// context lesson for the incident). 2026-grounded contract:
//   - the Keycloak token endpoint response is a THIRD-PARTY trust boundary:
//     KeycloakTokenResponseSchema is the Zod SSOT (strip mode); the type
//     exists only via z.infer (two-axis rule, AXIS 1 + AXIS 2).
//   - cache with a 60s pre-expiry buffer: clock skew means a locally-valid
//     token can be expired on arrival, so we refresh early.
//   - single-flight: concurrent cold callers share ONE in-flight fetch
//     (prevents the token-refresh stampede).
//   - invalidate(): the callback 401 hook. The caller invalidates then
//     throws; BullMQ at-least-once retry is the outer retry-once, so the
//     next attempt mints fresh. No inner retry loop duplicating the queue.
//   - failures NEVER cache and NEVER include the client secret.
import { z } from 'zod';

export const KeycloakTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
});
export type KeycloakTokenResponse = z.infer<typeof KeycloakTokenResponseSchema>;

const DEFAULT_EXPIRY_BUFFER_MS = 60_000;

export interface KeycloakClientCredentialsTokenProviderConfig {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Injected for tests; defaults to globalThis.fetch. */
  readonly fetchFn?: typeof globalThis.fetch;
  /** Injected clock (ms epoch) for deterministic tests; defaults to Date.now. */
  readonly now?: () => number;
  readonly expiryBufferMs?: number;
}

interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export class KeycloakClientCredentialsTokenProvider {
  private cached: CachedToken | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly config: KeycloakClientCredentialsTokenProviderConfig) {}

  /** Returns a valid access token, minting via client-credentials on demand. */
  getToken(): Promise<string> {
    const nowMs = (this.config.now ?? Date.now)();
    const bufferMs = this.config.expiryBufferMs ?? DEFAULT_EXPIRY_BUFFER_MS;
    if (this.cached && nowMs < this.cached.expiresAtMs - bufferMs) {
      return Promise.resolve(this.cached.token);
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.fetchToken().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** 401-from-API hook: drop the cache so the next getToken() mints fresh. */
  invalidate(): void {
    this.cached = null;
  }

  private async fetchToken(): Promise<string> {
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const startedMs = (this.config.now ?? Date.now)();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    }).toString();
    const res = await fetchFn(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      // Status only -- the secret must never enter an error message or log.
      throw new Error('keycloak token endpoint HTTP ' + String(res.status) + ' ' + res.statusText);
    }
    const raw: unknown = await res.json();
    const parsed = KeycloakTokenResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error('keycloak token response failed schema validation: ' + parsed.error.message);
    }
    this.cached = {
      token: parsed.data.access_token,
      expiresAtMs: startedMs + parsed.data.expires_in * 1000,
    };
    return parsed.data.access_token;
  }
}
