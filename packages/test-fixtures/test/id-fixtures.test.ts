// packages/test-fixtures/test/id-fixtures.test.ts
// The minter has to hold three properties or the tests that depend on it lie:
// every id is VALID (the factories validate now), the same label is always the
// SAME id, and different labels are DIFFERENT ids. Only the last two are what
// the consuming tests actually assert on -- they name ids for legibility and
// check relationships between them.
import { describe, it, expect } from 'vitest';
import { testActionId, testAggregateId } from '../src/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('@fleet/test-fixtures — branded id minting', () => {
  it('mints a valid v7 UUID for an action label', () => {
    expect(testActionId('a1')).toMatch(UUID);
  });

  it('mints a valid v7 UUID for an aggregate label', () => {
    expect(testAggregateId('agg-1')).toMatch(UUID);
  });

  // Determinism: a test referencing 'a1' twice must get one id, or a
  // relationship assertion would fail for a reason unrelated to the behaviour.
  it('is deterministic for the same label', () => {
    expect(testActionId('a1')).toBe(testActionId('a1'));
    expect(testAggregateId('agg-1')).toBe(testAggregateId('agg-1'));
  });

  it('is distinct for different labels', () => {
    expect(testActionId('a1')).not.toBe(testActionId('a2'));
    expect(testAggregateId('agg-1')).not.toBe(testAggregateId('agg-2'));
  });

  // Namespaced, so an action and an aggregate sharing a label are still
  // different ids -- the mix-up branding exists to prevent.
  it('separates the action and aggregate id spaces', () => {
    expect(String(testActionId('x'))).not.toBe(String(testAggregateId('x')));
  });

  it('survives labels that are already UUID-shaped or empty', () => {
    expect(testActionId('')).toMatch(UUID);
    expect(testActionId('018f4d3c-0001-7000-8000-000000000001')).toMatch(UUID);
  });

  // Enough distinct labels to catch a minter that collapses on short inputs.
  it('does not collide across a realistic label set', () => {
    const labels = ['a1', 'a2', 'a3', 'A', 'B', 'C', 'agg-1', 'agg-2', 'x', 'y'];
    const ids = new Set(labels.map((l) => String(testActionId(l))));
    expect(ids.size).toBe(labels.length);
  });
});
