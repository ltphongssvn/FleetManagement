// packages/test-fixtures/test/list-assigned-fixtures.test.ts
// The factory exists so a fixture cannot drift from the wire contract, so it
// must itself be proven to build only contract-valid rows -- an unverified
// factory is just a tidier literal.
//
// The drift it removes was real: driver-app fixtures omitted externalRef,
// createdAt, cargoName, driverName, canCancel and cancelBlockedReason, the same
// six the hand-rolled parser silently dropped, so fixture and parser agreed
// with each other while neither matched the wire.
import { describe, it, expect } from 'vitest';
import { ListAssignedRowSchema, ListAssignedRowStopSchema } from '@fleet/sync-protocol';
import { createListAssignedRow, createListAssignedStop } from '../src/list-assigned-fixtures.js';

describe('createListAssignedRow', () => {
  it('builds a row that satisfies the contract with no arguments', () => {
    expect(ListAssignedRowSchema.safeParse(createListAssignedRow()).success).toBe(true);
  });

  // The six fields the old literals omitted. Present by construction now.
  it('carries every field the hand-written literals dropped', () => {
    const row = createListAssignedRow();
    expect(row.externalRef).not.toBeUndefined();
    expect(row.createdAt).not.toBeUndefined();
    expect(row.cargoName).not.toBeUndefined();
    expect(row.driverName).not.toBeUndefined();
    expect(row.canCancel).not.toBeUndefined();
    expect(row.cancelBlockedReason).not.toBeUndefined();
  });

  it('applies overrides', () => {
    expect(createListAssignedRow({ state: 'dispatched', orderRef: 'XTT.09-002' }).state).toBe(
      'dispatched',
    );
  });

  it('still satisfies the contract after an override', () => {
    const row = createListAssignedRow({ plate: null, customerName: null, stops: [] });
    expect(ListAssignedRowSchema.safeParse(row).success).toBe(true);
  });

  // Overrides are parsed, not merged blindly: a caller cannot manufacture a
  // fixture no production code could ever receive, which is the whole point.
  it('THROWS on an override that violates the contract', () => {
    expect(() => createListAssignedRow({ roadRunId: 1 as unknown as string })).toThrow();
    expect(() => createListAssignedRow({ stops: 'nope' as unknown as [] })).toThrow();
  });
});

describe('createListAssignedStop', () => {
  it('builds a stop that satisfies the stop contract', () => {
    expect(ListAssignedRowStopSchema.safeParse(createListAssignedStop()).success).toBe(true);
  });

  it('applies overrides', () => {
    expect(createListAssignedStop({ sequence: 4, stopType: 'delivery' }).stopType).toBe('delivery');
  });

  it('THROWS on an override that violates the contract', () => {
    expect(() => createListAssignedStop({ sequence: 'x' as unknown as number })).toThrow();
  });
});
