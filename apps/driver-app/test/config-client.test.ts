// apps/driver-app/test/config-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchClientConfig } from '../src/config/config-client.js';

describe('@fleet/driver-app - fetchClientConfig', () => {
  it('returns parsed config on 200', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        configVersion: 1, polygonVersion: 1, hysteresisVersion: 1, configFlagVersion: 1,
        shadowSessionLimit: 5, shadowIdleTimeoutMs: 300000,
        arrivalHintDedupWindowSeconds: 30, arrivalHintExpiryHours: 24,
        geofenceToleranceMeters: 50, geofenceHysteresisSeconds: 30,
        tieBreakerBufferMeters: 25, bootstrapAbandonedAfterMinutes: 60,
        softGraceSeconds: 120, hardGraceSeconds: 10, advisoryLockMaxWaitMs: 5000,
        revocationReasonSchemaVersion: 1, retryPolicy: {}, capabilityFlags: {
          enableChunkChecksums: false, enableDynamicBackpressure: false,
          enableRuntimeStrictValidator: false, enableAtomicConfigLockCoordination: false,
          enableArtifactContendedShadowCircuitBreaker: false,
        },
      }),
    });
    const cfg = await fetchClientConfig({ apiUrl: 'http://api.test', bearerToken: () => 't', fetchFn: fetchFn as never });
    expect(cfg.softGraceSeconds).toBe(120);
    expect(cfg.capabilityFlags.enableChunkChecksums).toBe(false);
  });

  it('throws on non-200', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'err' });
    await expect(fetchClientConfig({ apiUrl: 'http://api.test', bearerToken: () => 't', fetchFn: fetchFn as never })).rejects.toThrow();
  });

  it('throws on shape mismatch', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ configVersion: 'wrong' }) });
    await expect(fetchClientConfig({ apiUrl: 'http://api.test', bearerToken: () => 't', fetchFn: fetchFn as never })).rejects.toThrow();
  });

  it('uses globalThis.fetch when fetchFn is not provided', async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        configVersion: 1, polygonVersion: 1, hysteresisVersion: 1, configFlagVersion: 1,
        shadowSessionLimit: 5, shadowIdleTimeoutMs: 300000,
        arrivalHintDedupWindowSeconds: 30, arrivalHintExpiryHours: 24,
        geofenceToleranceMeters: 50, geofenceHysteresisSeconds: 30,
        tieBreakerBufferMeters: 25, bootstrapAbandonedAfterMinutes: 60,
        softGraceSeconds: 120, hardGraceSeconds: 10, advisoryLockMaxWaitMs: 5000,
        revocationReasonSchemaVersion: 1, retryPolicy: {}, capabilityFlags: {
          enableChunkChecksums: false, enableDynamicBackpressure: false,
          enableRuntimeStrictValidator: false, enableAtomicConfigLockCoordination: false,
          enableArtifactContendedShadowCircuitBreaker: false,
        },
      }),
    });
    globalThis.fetch = spy as never;
    try {
      const cfg = await fetchClientConfig({ apiUrl: 'http://api.test', bearerToken: () => 't' });
      expect(cfg.softGraceSeconds).toBe(120);
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
