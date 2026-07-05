// apps/api/test/keycloak-events-client.test.ts
// L1 TDD for the Keycloak master-realm login-events client used by the break-glass
// monitor. Two outbound calls: (1) POST the token endpoint with client_credentials
// (confidential fleet-breakglass-monitor client) to get an access token; (2) GET the
// admin events endpoint (type=LOGIN, realm master) with Authorization: Bearer, since
// >= the cursor time, oldest-first. Response is parsed with KeycloakLoginEventSchema.
// fetchFn is an injected seam (globalThis.fetch fallback), mirroring FetchErpClient.
import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';

// Runtime-generated to avoid a credential-shaped literal (secret-scanner clean).
const MONITOR_CRED = `sec_${randomBytes(12).toString('hex')}`;
import { KeycloakEventsClient } from '../src/security/keycloak-events-client.js';

const CONFIG = {
  baseUrl: 'https://kc.test',
  realm: 'master',
  clientId: 'fleet-breakglass-monitor',
  clientSecret: MONITOR_CRED,
} as const;

function tokenRes(token: string): unknown {
  return { ok: true, status: 200, json: () => Promise.resolve({ access_token: token, token_type: 'Bearer', expires_in: 60 }) };
}
function eventsRes(events: unknown): unknown {
  return { ok: true, status: 200, json: () => Promise.resolve(events) };
}
function makeClient(fetchFn: unknown): KeycloakEventsClient {
  return new KeycloakEventsClient({ ...CONFIG, fetchFn: fetchFn as never });
}

const LOGIN_EVENT = {
  time: 1_751_000_000_000,
  type: 'LOGIN',
  realmId: 'master',
  userId: 'u-1',
  details: { username: 'fleet-breakglass-1' },
};

describe('@fleet/api - KeycloakEventsClient', () => {
  it('POSTs the token endpoint with client_credentials form body', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(tokenRes('tok-abc'))
      .mockResolvedValueOnce(eventsRes([LOGIN_EVENT]));
    await makeClient(fetchFn).fetchLoginEventsSince(0);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://kc.test/realms/master/protocol/openid-connect/token');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('fleet-breakglass-monitor');
    expect(body.get('client_secret')).toBe(MONITOR_CRED);
  });

  it('GETs the admin events endpoint with the bearer token, type=LOGIN, and dateFrom from the cursor', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(tokenRes('tok-xyz'))
      .mockResolvedValueOnce(eventsRes([LOGIN_EVENT]));
    await makeClient(fetchFn).fetchLoginEventsSince(1_751_000_000_000);
    const [url, init] = fetchFn.mock.calls[1] as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://kc.test/admin/realms/master/events');
    expect(u.searchParams.get('type')).toBe('LOGIN');
    expect(u.searchParams.get('dateFrom')).toBe('1751000000000');
    expect(u.searchParams.get('direction')).toBe('asc');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-xyz');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('parses and returns the events via KeycloakLoginEventSchema', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(tokenRes('t'))
      .mockResolvedValueOnce(eventsRes([LOGIN_EVENT]));
    const events = await makeClient(fetchFn).fetchLoginEventsSince(0);
    expect(events).toHaveLength(1);
    expect(events[0]?.details?.username).toBe('fleet-breakglass-1');
  });

  it('throws when the token response is not ok', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false, status: 401, statusText: 'Unauthorized', text: () => Promise.resolve('bad client'),
    });
    await expect(makeClient(fetchFn).fetchLoginEventsSince(0)).rejects.toThrow(/token.*401/i);
  });

  it('throws when the events response is not ok', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(tokenRes('t'))
      .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden', text: () => Promise.resolve('no view-events') });
    await expect(makeClient(fetchFn).fetchLoginEventsSince(0)).rejects.toThrow(/events.*403/i);
  });

  it('rejects a malformed event payload (schema guard)', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(tokenRes('t'))
      .mockResolvedValueOnce(eventsRes([{ type: 'LOGIN' }])); // missing time + realmId
    await expect(makeClient(fetchFn).fetchLoginEventsSince(0)).rejects.toThrow();
  });

  it('uses globalThis.fetch when no fetchFn is injected', async () => {
    const original = globalThis.fetch;
    const spy = vi.fn()
      .mockResolvedValueOnce(tokenRes('t'))
      .mockResolvedValueOnce(eventsRes([]));
    globalThis.fetch = spy as never;
    try {
      const client = new KeycloakEventsClient(CONFIG);
      const events = await client.fetchLoginEventsSince(0);
      expect(events).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws when the token response omits access_token', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ token_type: 'Bearer' }) });
    await expect(makeClient(fetchFn).fetchLoginEventsSince(0)).rejects.toThrow(/access_token/i);
  });

  it('still throws when the token error body cannot be read (catch fallback)', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized', text: () => Promise.reject(new Error('stream error')) });
    await expect(makeClient(fetchFn).fetchLoginEventsSince(0)).rejects.toThrow(/token.*401/i);
  });

  it('still throws when the events error body cannot be read (catch fallback)', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(tokenRes('t'))
      .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden', text: () => Promise.reject(new Error('stream error')) });
    await expect(makeClient(fetchFn).fetchLoginEventsSince(0)).rejects.toThrow(/events.*403/i);
  });

});
