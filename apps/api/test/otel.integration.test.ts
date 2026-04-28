// apps/api/test/otel.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { tagActiveSpan, recordSpanFailure } from '../src/observability/otel.js';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

describe('@fleet/api - OTel span helpers (integration)', () => {
  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  it('tagActiveSpan writes fleet.* attributes to active span', () => {
    exporter.reset();
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('test-span');
    context.with(trace.setSpan(context.active(), span), () => {
      tagActiveSpan({ manifestCorrelationId: 'mc-1', companyId: 'co-1' });
    });
    span.end();

    const finished = exporter.getFinishedSpans();
    expect(finished).toHaveLength(1);
    const first = finished[0];
    if (!first) throw new Error('expected one finished span');
    expect(first.attributes['fleet.manifestCorrelationId']).toBe('mc-1');
    expect(first.attributes['fleet.companyId']).toBe('co-1');
  });

  it('recordSpanFailure marks span ERROR with reasonCode', () => {
    exporter.reset();
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('failing-span');
    context.with(trace.setSpan(context.active(), span), () => {
      recordSpanFailure('upload_invalid', 'size mismatch');
    });
    span.end();

    const finished = exporter.getFinishedSpans();
    const first = finished[0];
    if (!first) throw new Error('expected one finished span');
    expect(first.status.code).toBe(SpanStatusCode.ERROR);
    expect(first.status.message).toBe('size mismatch');
    expect(first.attributes['fleet.failure.code']).toBe('upload_invalid');
  });

  it('tagActiveSpan no-ops when no span is active', () => {
    expect(() => {
      tagActiveSpan({ manifestCorrelationId: 'mc-2' });
    }).not.toThrow();
  });
});
