// apps/driver-app/src/auth/session-manager.ts
// The single owner of the rotated pair on-device (RFC 9700 public client).
// Framework-free and port-injected (fetchFn + storage + clock) so React and
// SecureStore are wiring, not logic. Guarantees:
//   - SSOT parsing at the wire boundary: login/refresh bodies are validated
//     against @fleet/sync-protocol; a non-conforming 200 fails CLOSED.
//   - Skew-aware pre-refresh: within SKEW_SECONDS of expiry, rotate first.
//   - Single-flight: one in-flight refresh promise is shared by all callers.
//   - Fail-closed session expiry: 401/403 on refresh clears storage.
//   - Fail-open on transport errors: network failures keep storage (retry).
//   - Logout: best-effort server revoke, storage always cleared.
import {
  DriverLoginResponseSchema,
  RefreshResponseSchema,
} from '@fleet/sync-protocol';
import type { StoredToken } from './token-storage.js';

const SKEW_SECONDS = 30;

export interface SessionStoragePort {
  load(): Promise<StoredToken | null>;
  save(token: StoredToken): Promise<void>;
  clear(): Promise<void>;
}

export interface SessionManagerOptions {
  readonly apiUrl: string;
  readonly fetchFn: typeof globalThis.fetch;
  readonly storage: SessionStoragePort;
  readonly nowMs?: () => number;
}

export type LoginResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'invalid-credentials' }
  | { readonly kind: 'protocol-error' }
  | { readonly kind: 'http-error'; readonly status: number };

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

export class SessionManager {
  private readonly apiUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly storage: SessionStoragePort;
  private readonly nowMs: () => number;
  private inFlightRefresh: Promise<StoredToken> | null = null;

  constructor(opts: SessionManagerOptions) {
    this.apiUrl = opts.apiUrl;
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

  private refreshOnce(refreshToken: string): Promise<StoredToken> {
    // Single-flight: the first caller installs the in-flight promise; all
    // concurrent callers await the same one, so exactly one POST is issued.
    this.inFlightRefresh ??= this.performRefresh(refreshToken).finally(() => {
      this.inFlightRefresh = null;
    });
    return this.inFlightRefresh;
  }

  private async performRefresh(refreshToken: string): Promise<StoredToken> {
    const res = await this.fetchFn(this.apiUrl + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (res.status === 401 || res.status === 403) {
      await this.storage.clear();
      throw new SessionExpiredError();
    }
    if (!res.ok) {
      throw new SessionExpiredError();
    }
    const parsed = RefreshResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      await this.storage.clear();
      throw new SessionExpiredError();
    }
    const nowSec = Math.floor(this.nowMs() / 1000);
    const next: StoredToken = {
      accessToken: parsed.data.accessToken,
      refreshToken: parsed.data.refreshToken,
      expiresAt: nowSec + parsed.data.expiresIn,
    };
    await this.storage.save(next);
    return next;
  }

  async login(phone: string, password: string): Promise<LoginResult> {
    const res = await this.fetchFn(this.apiUrl + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
    });
    if (res.status === 401) return { kind: 'invalid-credentials' };
    if (!res.ok) return { kind: 'http-error', status: res.status };
    const parsed = DriverLoginResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { kind: 'protocol-error' };
    const nowSec = Math.floor(this.nowMs() / 1000);
    await this.storage.save({
      accessToken: parsed.data.accessToken,
      refreshToken: parsed.data.refreshToken,
      expiresAt: nowSec + parsed.data.expiresIn,
    });
    return { kind: 'ok' };
  }

  async logout(): Promise<void> {
    const current = await this.storage.load();
    if (current === null) return;
    try {
      await this.fetchFn(this.apiUrl + '/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
    } catch {
      // Offline logout: revoke is best-effort; local clear is authoritative.
    }
    await this.storage.clear();
  }
}
