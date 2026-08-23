// apps/api/test/otel.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as otelApi from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';
import {
  startOtel,
  shutdownOtel,
  tagActiveSpan,
  recordSpanFailure,
} from '../src/observability/otel.js';

afterEach(() => {
  vi.restoreAllMocks();
});

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
    vi.spyOn(otelApi.trace, 'getActiveSpan').mockReturnValue(undefined);
    expect(() => {
      tagActiveSpan({ manifestCorrelationId: 'abc', companyId: 'co-1' });
    }).not.toThrow();
  });

  it('tagActiveSpan sets each attr with a fleet. prefix on the active span', () => {
    const setAttribute = vi.fn();
    vi.spyOn(otelApi.trace, 'getActiveSpan').mockReturnValue({
      setAttribute,
    } as unknown as otelApi.Span);
    tagActiveSpan({ corrId: 'abc', count: 3, ok: true });
    expect(setAttribute).toHaveBeenCalledWith('fleet.corrId', 'abc');
    expect(setAttribute).toHaveBeenCalledWith('fleet.count', 3);
    expect(setAttribute).toHaveBeenCalledWith('fleet.ok', true);
    expect(setAttribute).toHaveBeenCalledTimes(3);
  });

  it('tagActiveSpan does not call setAttribute when attrs is empty', () => {
    const setAttribute = vi.fn();
    vi.spyOn(otelApi.trace, 'getActiveSpan').mockReturnValue({
      setAttribute,
    } as unknown as otelApi.Span);
    tagActiveSpan({});
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it('recordSpanFailure no-ops when no active span', () => {
    vi.spyOn(otelApi.trace, 'getActiveSpan').mockReturnValue(undefined);
    expect(() => {
      recordSpanFailure('test_failure', 'no span attached');
    }).not.toThrow();
  });

  it('recordSpanFailure sets ERROR status with the provided message and the failure code attr', () => {
    const setStatus = vi.fn();
    const setAttribute = vi.fn();
    vi.spyOn(otelApi.trace, 'getActiveSpan').mockReturnValue({
      setStatus,
      setAttribute,
    } as unknown as otelApi.Span);
    recordSpanFailure('db_timeout', 'connection lost');
    expect(setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'connection lost',
    });
    expect(setAttribute).toHaveBeenCalledWith('fleet.failure.code', 'db_timeout');
  });

  it('recordSpanFailure with no message uses reasonCode as the status message', () => {
    const setStatus = vi.fn();
    const setAttribute = vi.fn();
    vi.spyOn(otelApi.trace, 'getActiveSpan').mockReturnValue({
      setStatus,
      setAttribute,
    } as unknown as otelApi.Span);
    recordSpanFailure('only_code');
    expect(setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'only_code' });
    expect(setAttribute).toHaveBeenCalledWith('fleet.failure.code', 'only_code');
  });

  it('returns early when enabled=false (line 30-32)', () => {
    expect(() => {
      startOtel({ enabled: false, serviceName: 's', serviceVersion: 'v' });
    }).not.toThrow();
  });

  it('shutdownOtel returns early when sdk null (line 63-64)', async () => {
    await expect(shutdownOtel()).resolves.toBeUndefined();
  });
});
