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

describe('@fleet/driver-app - fetchClientConfig mutation-hardening', () => {
  it('calls fetchFn with URL = `${apiUrl}/config/client` and Authorization header = `Bearer ${token}`', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: { headers?: Record<string, string> } | undefined;
    const fetchFn = vi.fn().mockImplementation((u: string, init: typeof capturedInit) => {
      capturedUrl = u;
      capturedInit = init;
      return Promise.resolve({
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
    });
    await fetchClientConfig({ apiUrl: 'http://api.test', bearerToken: () => 'mytoken', fetchFn: fetchFn as never });
    expect(capturedUrl).toBe('http://api.test/config/client');
    expect(capturedInit?.headers).toEqual({ Authorization: 'Bearer mytoken' });
  });

  it('non-200 throws an Error whose message names /config/client and the HTTP status', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'down' });
    await expect(fetchClientConfig({
      apiUrl: 'http://api.test', bearerToken: () => 't', fetchFn: fetchFn as never,
    })).rejects.toThrow(/\/config\/client HTTP 503 down/);
  });

  it('shape-mismatch throws an Error whose message names "invalid shape"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ configVersion: 'wrong' }) });
    await expect(fetchClientConfig({
      apiUrl: 'http://api.test', bearerToken: () => 't', fetchFn: fetchFn as never,
    })).rejects.toThrow(/invalid shape/);
  });

  it('rejects retryPolicy jitterRatio outside [0,1] (kills .min(0)/.max(1) -> .min(1)/.max(0) mutants)', async () => {
    // jitterRatio is in retryPolicy: { [key]: { maxAttempts, baseSeconds, jitterRatio } }
    // Mutating .max(1) to .min(1) would still accept 1; .max(0) would reject everything > 0.
    // Test: a jitterRatio of 0.5 must be accepted.
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        configVersion: 1, polygonVersion: 1, hysteresisVersion: 1, configFlagVersion: 1,
        shadowSessionLimit: 5, shadowIdleTimeoutMs: 300000,
        arrivalHintDedupWindowSeconds: 30, arrivalHintExpiryHours: 24,
        geofenceToleranceMeters: 50, geofenceHysteresisSeconds: 30,
        tieBreakerBufferMeters: 25, bootstrapAbandonedAfterMinutes: 60,
        softGraceSeconds: 120, hardGraceSeconds: 10, advisoryLockMaxWaitMs: 5000,
        revocationReasonSchemaVersion: 1,
        retryPolicy: { 'sync': { maxAttempts: 5, baseSeconds: 2, jitterRatio: 0.5 } },
        capabilityFlags: {
          enableChunkChecksums: false, enableDynamicBackpressure: false,
          enableRuntimeStrictValidator: false, enableAtomicConfigLockCoordination: false,
          enableArtifactContendedShadowCircuitBreaker: false,
        },
      }),
    });
    const cfg = await fetchClientConfig({ apiUrl: 'http://api.test', bearerToken: () => 't', fetchFn: fetchFn as never });
    expect(cfg.retryPolicy['sync']?.jitterRatio).toBe(0.5);
  });

  it('rejects retryPolicy with jitterRatio > 1 (kills .max(1) -> .min(1) mutant from the other side)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        configVersion: 1, polygonVersion: 1, hysteresisVersion: 1, configFlagVersion: 1,
        shadowSessionLimit: 5, shadowIdleTimeoutMs: 300000,
        arrivalHintDedupWindowSeconds: 30, arrivalHintExpiryHours: 24,
        geofenceToleranceMeters: 50, geofenceHysteresisSeconds: 30,
        tieBreakerBufferMeters: 25, bootstrapAbandonedAfterMinutes: 60,
        softGraceSeconds: 120, hardGraceSeconds: 10, advisoryLockMaxWaitMs: 5000,
        revocationReasonSchemaVersion: 1,
        retryPolicy: { 'sync': { maxAttempts: 5, baseSeconds: 2, jitterRatio: 1.5 } },
        capabilityFlags: {
          enableChunkChecksums: false, enableDynamicBackpressure: false,
          enableRuntimeStrictValidator: false, enableAtomicConfigLockCoordination: false,
          enableArtifactContendedShadowCircuitBreaker: false,
        },
      }),
    });
    await expect(fetchClientConfig({
      apiUrl: 'http://api.test', bearerToken: () => 't', fetchFn: fetchFn as never,
    })).rejects.toThrow();
  });
});
