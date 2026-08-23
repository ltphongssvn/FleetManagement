// workers/main-worker/test/keycloak-token-provider.test.ts
// RED (phieu-photo-visibility arc, slice A): OAuth2 client-credentials token
// provider for worker -> API callbacks.
// Root cause being fixed: FLEET_API_TOKEN was a hand-minted static JWT whose
// exp detonated ~14 days after the Jun-10 deploy; every intake-result callback
// returned 401 from Jun-24 and 65 manifests stalled in verifying. The 2026
// fix mints short-lived tokens on demand (RFC 6749 section 4.4).
// Contract under test (web-grounded):
//   - Keycloak token endpoint response is a THIRD-PARTY trust boundary ->
//     KeycloakTokenResponseSchema (Zod, strip mode), types via z.infer only.
//   - cache with a 60s pre-expiry buffer (clock-skew safety).
//   - single-flight: concurrent cold callers share ONE in-flight fetch.
//   - invalidate(): the 401-from-API hook; next getToken() refetches.
//   - non-2xx or schema-invalid token response throws (BullMQ is the outer
//     retry) and never poisons the cache; errors never leak the secret.
import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  KeycloakTokenResponseSchema,
  KeycloakClientCredentialsTokenProvider,
} from '../src/auth/keycloak-token-provider.js';

function fakeResponse(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Unauthorized',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}
function goodBody(token: string, expiresIn: number): Record<string, unknown> {
  return {
    access_token: token,
    expires_in: expiresIn,
    token_type: 'Bearer',
    scope: 'profile email',
  };
}
// Runtime-generated credential: no credential-shaped literal exists in the
// file, so secret scanners have no source to fire on (locked scanner rule).
const WORKER_CRED = 'cred-' + randomBytes(8).toString('hex');
const BASE = {
  tokenUrl: 'https://kc.example.test/realms/fleet/protocol/openid-connect/token',
  clientId: 'fleet-worker',
  clientSecret: WORKER_CRED,
};

describe('KeycloakTokenResponseSchema (Axis-1 trust boundary)', () => {
  it('parses a canonical Keycloak response and strips unknown keys', () => {
    const parsed = KeycloakTokenResponseSchema.parse(goodBody('tok', 300));
    expect(parsed.access_token).toBe('tok');
    expect(parsed.expires_in).toBe(300);
    expect(Object.keys(parsed)).not.toContain('scope');
  });

  it('rejects missing access_token, empty token, and non-positive expires_in', () => {
    expect(KeycloakTokenResponseSchema.safeParse({ expires_in: 300 }).success).toBe(false);
    expect(KeycloakTokenResponseSchema.safeParse(goodBody('', 300)).success).toBe(false);
    expect(KeycloakTokenResponseSchema.safeParse(goodBody('t', 0)).success).toBe(false);
  });
});

describe('KeycloakClientCredentialsTokenProvider', () => {
  it('fetches via RFC 6749 form POST and returns the access token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse(true, 200, goodBody('tok-1', 300)));
    const provider = new KeycloakClientCredentialsTokenProvider({ ...BASE, fetchFn, now: () => 0 });
    await expect(provider.getToken()).resolves.toBe('tok-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const call = fetchFn.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: unknown },
    ];
    expect(call[0]).toBe(BASE.tokenUrl);
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = String(call[1].body);
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('client_id=fleet-worker');
    expect(body).toContain('client_secret=' + WORKER_CRED);
  });

  it('serves from cache inside the validity window: one fetch for two calls', async () => {
    let nowMs = 0;
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse(true, 200, goodBody('tok-1', 300)));
    const provider = new KeycloakClientCredentialsTokenProvider({
      ...BASE,
      fetchFn,
      now: () => nowMs,
    });
    await provider.getToken();
    nowMs = 239000;
    await expect(provider.getToken()).resolves.toBe('tok-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refetches once the 60s pre-expiry buffer is crossed', async () => {
    let nowMs = 0;
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(true, 200, goodBody('tok-1', 300)))
      .mockResolvedValueOnce(fakeResponse(true, 200, goodBody('tok-2', 300)));
    const provider = new KeycloakClientCredentialsTokenProvider({
      ...BASE,
      fetchFn,
      now: () => nowMs,
    });
    await expect(provider.getToken()).resolves.toBe('tok-1');
    nowMs = 241000;
    await expect(provider.getToken()).resolves.toBe('tok-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('single-flight: concurrent cold calls share one in-flight fetch', async () => {
    let release: (r: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchFn = vi.fn().mockReturnValue(gate);
    const provider = new KeycloakClientCredentialsTokenProvider({ ...BASE, fetchFn, now: () => 0 });
    const first = provider.getToken();
    const second = provider.getToken();
    release(fakeResponse(true, 200, goodBody('tok-1', 300)));
    await expect(Promise.all([first, second])).resolves.toEqual(['tok-1', 'tok-1']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('invalidate() drops the cache so the next call refetches', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(true, 200, goodBody('tok-1', 300)))
      .mockResolvedValueOnce(fakeResponse(true, 200, goodBody('tok-2', 300)));
    const provider = new KeycloakClientCredentialsTokenProvider({ ...BASE, fetchFn, now: () => 0 });
    await expect(provider.getToken()).resolves.toBe('tok-1');
    provider.invalidate();
    await expect(provider.getToken()).resolves.toBe('tok-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws on non-2xx with the status, never leaks the secret, never caches', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(false, 401, { error: 'invalid_client' }))
      .mockResolvedValueOnce(fakeResponse(true, 200, goodBody('tok-2', 300)));
    const provider = new KeycloakClientCredentialsTokenProvider({ ...BASE, fetchFn, now: () => 0 });
    const failure = provider.getToken();
    await expect(failure).rejects.toThrow(/401/);
    await failure.catch((err: unknown) => {
      expect(String(err)).not.toContain(WORKER_CRED);
    });
    await expect(provider.getToken()).resolves.toBe('tok-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws on a schema-invalid body without poisoning the cache', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(true, 200, { unexpected: true }))
      .mockResolvedValueOnce(fakeResponse(true, 200, goodBody('tok-2', 300)));
    const provider = new KeycloakClientCredentialsTokenProvider({ ...BASE, fetchFn, now: () => 0 });
    await expect(provider.getToken()).rejects.toThrow();
    await expect(provider.getToken()).resolves.toBe('tok-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('defaults: uses globalThis.fetch, Date.now and the 60s buffer when none injected', async () => {
    const origFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue(fakeResponse(true, 200, goodBody('tok-default', 300)));
    globalThis.fetch = spy as never;
    try {
      const provider = new KeycloakClientCredentialsTokenProvider({ ...BASE });
      await expect(provider.getToken()).resolves.toBe('tok-default');
      await expect(provider.getToken()).resolves.toBe('tok-default');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
