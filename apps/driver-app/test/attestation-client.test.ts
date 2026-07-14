// apps/driver-app/test/attestation-client.test.ts
// RED (device-binding arc, P6 s2): AttestationClient orchestrates the device
// attestation handshake -- GET a nonce, produce the platform proof via an
// injected app-integrity port (Android base64 DER cert chain joined by
// newline; iOS attestationObject + keyId), POST to /device/attest/verify.
// The native module + fetch are injected so the client is unit-testable.
/* eslint-disable @typescript-eslint/unbound-method -- vitest mock method references are safe */
import { describe, it, expect, vi } from 'vitest';
import { AttestationClient, type AppIntegrityPort } from '../src/device/attestation-client.js';

const NONCE = 'server-nonce-123';
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: 'OK', json: () => Promise.resolve(body) } as unknown as Response;
}
function makeFetch(nonceBody: unknown, verifyBody: unknown): typeof globalThis.fetch {
  return vi.fn((url: string) => {
    if (url.includes('/device/attest/nonce')) return Promise.resolve(jsonResponse(nonceBody));
    return Promise.resolve(jsonResponse(verifyBody));
  }) as unknown as typeof globalThis.fetch;
}

describe('AttestationClient', () => {
  it('android: fetches a nonce, builds the cert-chain token, posts verify', async () => {
    const integrity: AppIntegrityPort = {
      isAvailable: vi.fn(() => Promise.resolve(true)),
      platform: 'android',
      prepareKey: vi.fn(() => Promise.resolve('key-id-android')),
      attestKey: vi.fn(() => Promise.resolve(undefined)),
      getCertificateChain: vi.fn(() => Promise.resolve(['Y2VydDA=', 'Y2VydDE='])),
    };
    const fetchFn = makeFetch({ nonce: NONCE }, { verified: true });
    const client = new AttestationClient({
      apiUrl: 'https://api.test',
      bearerToken: () => 'tok',
      integrity,
      deviceId: '00000000-0000-0000-0000-0000000000d1',
      fetchFn,
    });
    const r = await client.attest();
    expect(r).toEqual({ verified: true });
    expect(integrity.getCertificateChain).toHaveBeenCalled();
    const calls = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const verifyCall = calls.find((c) => String(c[0]).includes('/verify'));
    const body = JSON.parse((verifyCall?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(body['platform']).toBe('android');
    expect(body['token']).toBe(['Y2VydDA=', 'Y2VydDE='].join(String.fromCharCode(10)));
    expect(body['deviceId']).toBe('00000000-0000-0000-0000-0000000000d1');
  });

  it('ios: sends attestationObject as token plus keyId', async () => {
    const integrity: AppIntegrityPort = {
      isAvailable: vi.fn(() => Promise.resolve(true)),
      platform: 'ios',
      prepareKey: vi.fn(() => Promise.resolve('key-id-ios')),
      attestKey: vi.fn(() => Promise.resolve('YXR0ZXN0LW9iag==')),
      getCertificateChain: vi.fn(() => Promise.resolve([])),
    };
    const fetchFn = makeFetch({ nonce: NONCE }, { verified: true });
    const client = new AttestationClient({
      apiUrl: 'https://api.test',
      bearerToken: () => 'tok',
      integrity,
      deviceId: '00000000-0000-0000-0000-0000000000d1',
      fetchFn,
    });
    await client.attest();
    expect(integrity.attestKey).toHaveBeenCalledWith('key-id-ios', NONCE);
    const calls = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const verifyCall = calls.find((c) => String(c[0]).includes('/verify'));
    const body = JSON.parse((verifyCall?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(body['platform']).toBe('ios');
    expect(body['token']).toBe('YXR0ZXN0LW9iag==');
    expect(body['keyId']).toBe('key-id-ios');
  });

  it('returns unavailable when the platform has no attestation support', async () => {
    const integrity: AppIntegrityPort = {
      isAvailable: vi.fn(() => Promise.resolve(false)),
      platform: 'android',
      prepareKey: vi.fn(),
      attestKey: vi.fn(),
      getCertificateChain: vi.fn(),
    };
    const fetchFn = makeFetch({ nonce: NONCE }, { verified: true });
    const client = new AttestationClient({
      apiUrl: 'https://api.test',
      bearerToken: () => 'tok',
      integrity,
      deviceId: '00000000-0000-0000-0000-0000000000d1',
      fetchFn,
    });
    const r = await client.attest();
    expect(r).toEqual({ verified: false, reason: 'unavailable' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws when the verify endpoint rejects the attestation', async () => {
    const integrity: AppIntegrityPort = {
      isAvailable: vi.fn(() => Promise.resolve(true)),
      platform: 'android',
      prepareKey: vi.fn(() => Promise.resolve('k')),
      attestKey: vi.fn(() => Promise.resolve(undefined)),
      getCertificateChain: vi.fn(() => Promise.resolve(['Y2VydA=='])),
    };
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/nonce')) return Promise.resolve(jsonResponse({ nonce: NONCE }));
      return Promise.resolve(jsonResponse({ code: 'DEVICE_NOT_REGISTERED' }, false, 403));
    }) as unknown as typeof globalThis.fetch;
    const client = new AttestationClient({
      apiUrl: 'https://api.test',
      bearerToken: () => 'tok',
      integrity,
      deviceId: '00000000-0000-0000-0000-0000000000d1',
      fetchFn,
    });
    await expect(client.attest()).rejects.toThrow();
  });
});
