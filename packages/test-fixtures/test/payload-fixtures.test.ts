// packages/test-fixtures/test/payload-fixtures.test.ts
import { describe, it, expect } from 'vitest';
import {
  createCommandPayload,
  createNegotiateUploadInput,
  createCommitUploadInput,
  createCreateTransportOrderInput,
} from '../src/index.js';

describe('@fleet/test-fixtures - payload fixtures', () => {
  it('createCommandPayload returns valid defaults', () => {
    const c = createCommandPayload();
    expect(c.commandId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(c.type).toBe('assign_run');
    expect(c.targetOperatorId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(c.aggregateType).toBe('road_run');
    expect(c.aggregateId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(c.payload).toEqual({});
    expect(typeof c.issuedAt).toBe('string');
    expect(Object.isFrozen(c)).toBe(true);
  });
  it('createCommandPayload merges overrides', () => {
    const c = createCommandPayload({ type: 'cancel_run', payload: { reason: 'x' } });
    expect(c.type).toBe('cancel_run');
    expect(c.payload).toEqual({ reason: 'x' });
  });

  it('createNegotiateUploadInput returns valid defaults', () => {
    const n = createNegotiateUploadInput();
    expect(n.manifestCorrelationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(n.transportOrderId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(n.contentType).toBe('image/jpeg');
    expect(n.expectedSizeBytes).toBeGreaterThan(0);
  });
  it('createNegotiateUploadInput merges overrides', () => {
    const n = createNegotiateUploadInput({ contentType: 'application/pdf' });
    expect(n.contentType).toBe('application/pdf');
  });

  it('createCommitUploadInput returns valid defaults', () => {
    const c = createCommitUploadInput();
    expect(c.uploadSessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(c.actualSizeBytes).toBeGreaterThan(0);
    // Assert exact default string content (kills 'a' -> '' mutant)
    expect(c.contentHash).toBe('a'.repeat(64));
    expect(c.contentHash.length).toBe(64);
  });

  it('createCreateTransportOrderInput returns valid defaults', () => {
    const t = createCreateTransportOrderInput();
    expect(t.stops.length).toBeGreaterThan(0);
    expect(t.stops[0]?.sequence).toBe(1);
    // Assert exact default externalRef + stopType (kills 'TO-DEFAULT' -> '' and 'pickup' -> '' mutants)
    expect(t.externalRef).toBe('TO-DEFAULT');
    expect(t.stops[0]?.stopType).toBe('pickup');
  });
  it('createCreateTransportOrderInput accepts stops override', () => {
    const t = createCreateTransportOrderInput({
      stops: [
        { sequence: 1, stopType: 'pickup' },
        { sequence: 2, stopType: 'dropoff' },
      ],
    });
    expect(t.stops.length).toBe(2);
  });
});
