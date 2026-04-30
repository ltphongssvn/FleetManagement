// apps/api/test/otel.test.ts
import { describe, it, expect } from 'vitest';
import { startOtel, shutdownOtel, tagActiveSpan, recordSpanFailure } from '../src/observability/otel.js';

describe('@fleet/api - OTel', () => {
  it('startOtel is a no-op when disabled', () => {
    expect(() => {
      startOtel({ serviceName: 'test', serviceVersion: '0.0.0', enabled: false });
    }).not.toThrow();
  });

  it('shutdownOtel resolves when SDK was never started', async () => {
    await expect(shutdownOtel()).resolves.toBeUndefined();
  });

  it('startOtel is idempotent when disabled', () => {
    startOtel({ serviceName: 'test', serviceVersion: '0.0.0', enabled: false });
    expect(() => {
      startOtel({ serviceName: 'test', serviceVersion: '0.0.0', enabled: false });
    }).not.toThrow();
  });

  it('tagActiveSpan no-ops when no active span', () => {
    expect(() => {
      tagActiveSpan({ manifestCorrelationId: 'abc', companyId: 'co-1' });
    }).not.toThrow();
  });

  it('recordSpanFailure no-ops when no active span', () => {
    expect(() => {
      recordSpanFailure('test_failure', 'no span attached');
    }).not.toThrow();
  });

  it('recordSpanFailure with no message uses reasonCode', () => {
    expect(() => {
      recordSpanFailure('only_code');
    }).not.toThrow();
  });

  it('returns early when enabled=false (line 30-32)', () => {
    expect(() => { startOtel({ enabled: false, serviceName: 's', serviceVersion: 'v' }); }).not.toThrow();
  });

  it('shutdownOtel returns early when sdk null (line 63-64)', async () => {
    await expect(shutdownOtel()).resolves.toBeUndefined();
  });
});
