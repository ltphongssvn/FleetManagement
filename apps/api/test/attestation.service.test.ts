// apps/api/test/attestation.service.test.ts
// RED: AttestationService orchestrates platform-specific token verification +
// policy. Injected verifiers (Google Play Integrity JWS, Apple App Attest DER)
// keep this service unit-testable with no network.
import { describe, it, expect, vi } from 'vitest';
import { AttestationService, type VerifyPlayIntegrityFn, type VerifyAppAttestFn, type AttestationConfig } from '../src/device/attestation.service.js';

const CFG: AttestationConfig = {
  allowed: { android: ['com.fleet.driver'], ios: ['com.fleet.driver'] },
  maxAgeMs: 5 * 60 * 1000,
};

describe('AttestationService', () => {
  it('verifies Android token via Play Integrity verifier and accepts when policy says ok', async () => {
    const verifyPlay: VerifyPlayIntegrityFn = vi.fn().mockResolvedValue({
      packageName: 'com.fleet.driver',
      deviceIntegrity: ['MEETS_DEVICE_INTEGRITY'],
      appIntegrity: 'PLAY_RECOGNIZED',
      nonce: 'expected-nonce',
      timestampMs: Date.now(),
    });
    const verifyApple: VerifyAppAttestFn = vi.fn();
    const svc = new AttestationService(verifyPlay, verifyApple, CFG);
    const r = await svc.verify({ platform: 'android', token: 'jws-token', expectedNonce: 'expected-nonce' });
    expect(r.kind).toBe('ok');
    expect(verifyPlay).toHaveBeenCalledOnce();
    expect(verifyApple).not.toHaveBeenCalled();
  });

  it('verifies iOS token via App Attest verifier and accepts when policy says ok', async () => {
    const verifyPlay: VerifyPlayIntegrityFn = vi.fn();
    const verifyApple: VerifyAppAttestFn = vi.fn().mockResolvedValue({
      bundleId: 'com.fleet.driver',
      nonce: 'expected-nonce',
      timestampMs: Date.now(),
    });
    const svc = new AttestationService(verifyPlay, verifyApple, CFG);
    const r = await svc.verify({ platform: 'ios', token: 'der-token', expectedNonce: 'expected-nonce' });
    expect(r.kind).toBe('ok');
    expect(verifyApple).toHaveBeenCalledOnce();
    expect(verifyPlay).not.toHaveBeenCalled();
  });

  it('rejects with nonce-mismatch when returned nonce differs', async () => {
    const verifyPlay: VerifyPlayIntegrityFn = vi.fn().mockResolvedValue({
      packageName: 'com.fleet.driver',
      deviceIntegrity: ['MEETS_DEVICE_INTEGRITY'],
      appIntegrity: 'PLAY_RECOGNIZED',
      nonce: 'attacker-nonce',
      timestampMs: Date.now(),
    });
    const svc = new AttestationService(verifyPlay, vi.fn(), CFG);
    const r = await svc.verify({ platform: 'android', token: 't', expectedNonce: 'server-nonce' });
    expect(r.kind).toBe('nonce-mismatch');
  });

  it('rejects with stale when token timestamp is older than maxAgeMs', async () => {
    const verifyPlay: VerifyPlayIntegrityFn = vi.fn().mockResolvedValue({
      packageName: 'com.fleet.driver',
      deviceIntegrity: ['MEETS_DEVICE_INTEGRITY'],
      appIntegrity: 'PLAY_RECOGNIZED',
      nonce: 'n',
      timestampMs: Date.now() - 6 * 60 * 1000,
    });
    const svc = new AttestationService(verifyPlay, vi.fn(), CFG);
    const r = await svc.verify({ platform: 'android', token: 't', expectedNonce: 'n' });
    expect(r.kind).toBe('stale');
  });

  it('rejects with device-untrusted when Android verdict missing MEETS_DEVICE_INTEGRITY', async () => {
    const verifyPlay: VerifyPlayIntegrityFn = vi.fn().mockResolvedValue({
      packageName: 'com.fleet.driver',
      deviceIntegrity: ['MEETS_BASIC_INTEGRITY'],
      appIntegrity: 'PLAY_RECOGNIZED',
      nonce: 'n',
      timestampMs: Date.now(),
    });
    const svc = new AttestationService(verifyPlay, vi.fn(), CFG);
    const r = await svc.verify({ platform: 'android', token: 't', expectedNonce: 'n' });
    expect(r.kind).toBe('device-untrusted');
  });

  it('propagates verifier error as { kind: invalid-platform-data } (treats malformed/unverifiable tokens uniformly)', async () => {
    const verifyPlay: VerifyPlayIntegrityFn = vi.fn().mockRejectedValue(new Error('jws bad signature'));
    const svc = new AttestationService(verifyPlay, vi.fn(), CFG);
    const r = await svc.verify({ platform: 'android', token: 'bad', expectedNonce: 'n' });
    expect(r.kind).toBe('invalid-platform-data');
  });
});
