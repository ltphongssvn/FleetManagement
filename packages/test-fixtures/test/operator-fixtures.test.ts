// packages/test-fixtures/test/operator-fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { createOperatorContext, createSyncAction } from '../src/index.js';

describe('@fleet/test-fixtures - operator fixtures', () => {
  it('createOperatorContext returns a frozen valid OperatorContext with default UUIDs', () => {
    const op = createOperatorContext();
    expect(op.operatorId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(op.companyId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(op.businessUnitId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(op.depotId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(op.legalEntityId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Object.isFrozen(op)).toBe(true);
  });
  it('createOperatorContext accepts overrides', () => {
    const op = createOperatorContext({ operatorId: '00000000-0000-0000-0000-000000000aaa' });
    expect(op.operatorId).toBe('00000000-0000-0000-0000-000000000aaa');
  });
  it('returns distinct objects on each call (no shared mutable state)', () => {
    const a = createOperatorContext();
    const b = createOperatorContext();
    expect(a).not.toBe(b);
    expect(a.operatorId).not.toBe(b.operatorId);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
});

describe('@fleet/test-fixtures - sync action fixture', () => {
  it('createSyncAction returns a defaulted SyncActionInput-shaped object', () => {
    const a = createSyncAction();
    expect(a.actionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(a.aggregateType).toBe('transport_order');
    expect(a.aggregateId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(a.payload).toEqual({});
    expect(typeof a.timestamp).toBe('string');
  });
  it('createSyncAction merges overrides', () => {
    const a = createSyncAction({ aggregateType: 'manifest', payload: { foo: 1 } });
    expect(a.aggregateType).toBe('manifest');
    expect(a.payload).toEqual({ foo: 1 });
  });
});
