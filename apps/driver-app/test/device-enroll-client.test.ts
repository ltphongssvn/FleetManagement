// apps/driver-app/test/device-enroll-client.test.ts
// RED (device-binding arc, P6 s3): DeviceEnrollClient POSTs the device
// enrollment (platform + appVersion) to /devices/enroll and returns the
// server-minted deviceId. fetch + bearer token injected -> unit-testable.
import { describe, it, expect, vi } from 'vitest';
import { DeviceEnrollClient } from '../src/device/device-enroll-client.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: 'OK', json: () => Promise.resolve(body) } as unknown as Response;
}

describe('DeviceEnrollClient', () => {
  it('posts platform + appVersion and returns the deviceId', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ deviceId: '00000000-0000-0000-0000-0000000000d1' }))) as unknown as typeof globalThis.fetch;
    const client = new DeviceEnrollClient({
      apiUrl: 'https://api.test',
      bearerToken: () => 'tok',
      platform: 'android',
      appVersion: '2.31.0',
      fetchFn,
    });
    const id = await client.enroll();
    expect(id).toBe('00000000-0000-0000-0000-0000000000d1');
    const call = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(String(call?.[0])).toContain('/devices/enroll');
    const opts = call?.[1] as { method: string; headers: Record<string, string>; body: string };
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Bearer tok');
    const body = JSON.parse(opts.body) as Record<string, unknown>;
    expect(body['platform']).toBe('android');
    expect(body['appVersion']).toBe('2.31.0');
  });

  it('includes an optional expoPushToken when provided', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ deviceId: '00000000-0000-0000-0000-0000000000d2' }))) as unknown as typeof globalThis.fetch;
    const client = new DeviceEnrollClient({
      apiUrl: 'https://api.test', bearerToken: () => 'tok',
      platform: 'ios', appVersion: '2.31.0', expoPushToken: 'ExponentPushToken[x]', fetchFn,
    });
    await client.enroll();
    const call = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const body = JSON.parse((call?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(body['expoPushToken']).toBe('ExponentPushToken[x]');
  });

  it('throws when enrollment returns non-ok', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({}, false, 401))) as unknown as typeof globalThis.fetch;
    const client = new DeviceEnrollClient({
      apiUrl: 'https://api.test', bearerToken: () => 'tok', platform: 'android', appVersion: '2.31.0', fetchFn,
    });
    await expect(client.enroll()).rejects.toThrow(/enroll HTTP/i);
  });

  it('throws when the response lacks a deviceId', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({}))) as unknown as typeof globalThis.fetch;
    const client = new DeviceEnrollClient({
      apiUrl: 'https://api.test', bearerToken: () => 'tok', platform: 'android', appVersion: '2.31.0', fetchFn,
    });
    await expect(client.enroll()).rejects.toThrow(/deviceId/i);
  });
});
