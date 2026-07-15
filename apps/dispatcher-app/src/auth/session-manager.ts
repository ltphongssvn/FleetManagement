// apps/dispatcher-app/src/auth/session-manager.ts
// DispatcherSessionManager (T17 V10c-auth): the single owner of the rotated
// passkey token pair on-device. A deliberate hybrid of two proven house
// patterns -- the driver-app token LIFECYCLE (skew-aware pre-refresh,
// single-flight, port-injected storage + clock, fail-closed on 401/403,
// fail-open on transport error) and the ops-web KEYCLOAK refresh CONTRACT
// (grant_type=refresh_token, x-www-form-urlencoded, straight to the token
// endpoint) -- because a native passkey session keeps tokens in SecureStore
// (no httpOnly cookies) and rotates at Keycloak, not the api. Framework-
// free and port-injected so React + SecureStore stay wiring, not logic.
// getAccessToken is the getToken seam createCopilotClient consumes.
import { z } from 'zod';
const SKEW_SECONDS = 30;
// Keycloak token response at the trust boundary. refresh_token is optional
// (Keycloak may omit it when rotation is off) -> reuse the current one.
const TokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
});
export interface DispatcherStoredToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}
export interface DispatcherSessionStoragePort {
  load(): Promise<DispatcherStoredToken | null>;
  save(token: DispatcherStoredToken): Promise<void>;
  clear(): Promise<void>;
}
export interface DispatcherRefreshEnv {
  readonly tokenEndpoint: string;
  readonly clientId: string;
}
export interface DispatcherSessionManagerOptions {
  readonly env: DispatcherRefreshEnv;
  readonly fetchFn: typeof globalThis.fetch;
  readonly storage: DispatcherSessionStoragePort;
  readonly nowMs?: () => number;
}
export class NotAuthenticatedError extends Error {
  constructor() {
    super('Not authenticated');
    this.name = 'NotAuthenticatedError';
  }
}
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}
export class DispatcherSessionManager {
  private readonly env: DispatcherRefreshEnv;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly storage: DispatcherSessionStoragePort;
  private readonly nowMs: () => number;
  private inFlightRefresh: Promise<DispatcherStoredToken> | null = null;
  constructor(opts: DispatcherSessionManagerOptions) {
    this.env = opts.env;
    this.fetchFn = opts.fetchFn;
    this.storage = opts.storage;
    this.nowMs = opts.nowMs ?? Date.now;
  }
  async getAccessToken(opts?: { forceRefresh?: boolean }): Promise<string> {
    const current = await this.storage.load();
    if (current === null) throw new NotAuthenticatedError();
    const nowSec = Math.floor(this.nowMs() / 1000);
    const force = opts?.forceRefresh === true;
    if (!force && current.expiresAt - SKEW_SECONDS > nowSec) {
      return current.accessToken;
    }
    const rotated = await this.refreshOnce(current.refreshToken);
    return rotated.accessToken;
  }
  private refreshOnce(refreshToken: string): Promise<DispatcherStoredToken> {
    this.inFlightRefresh ??= this.performRefresh(refreshToken).finally(() => {
      this.inFlightRefresh = null;
    });
    return this.inFlightRefresh;
  }
  private async performRefresh(refreshToken: string): Promise<DispatcherStoredToken> {
    const res = await this.fetchFn(this.env.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.env.clientId,
      }).toString(),
      cache: 'no-store',
    });
    if (res.status === 401 || res.status === 403) {
      await this.storage.clear();
      throw new SessionExpiredError();
    }
    if (!res.ok) throw new SessionExpiredError();
    const parsed = TokenResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      await this.storage.clear();
      throw new SessionExpiredError();
    }
    const nowSec = Math.floor(this.nowMs() / 1000);
    const next: DispatcherStoredToken = {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token ?? refreshToken,
      expiresAt: nowSec + (parsed.data.expires_in ?? 300),
    };
    await this.storage.save(next);
    return next;
  }
}
