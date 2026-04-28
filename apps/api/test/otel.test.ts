// apps/api/test/otel.test.ts
import { describe, it, expect } from 'vitest';
import { startOtel, shutdownOtel } from '../src/observability/otel.js';

describe('@fleet/api - OTel', () => {
  it('startOtel is a no-op when disabled', () => {
    expect(() => {
      startOtel({ serviceName: 'test', serviceVersion: '0.0.0', enabled: false });
    }).not.toThrow();
  });

  it('shutdownOtel resolves when SDK was never started', async () => {
    await expect(shutdownOtel()).resolves.toBeUndefined();
  });

  it('startOtel is idempotent (does not throw on second call when disabled)', () => {
    startOtel({ serviceName: 'test', serviceVersion: '0.0.0', enabled: false });
    expect(() => {
      startOtel({ serviceName: 'test', serviceVersion: '0.0.0', enabled: false });
    }).not.toThrow();
  });
});
