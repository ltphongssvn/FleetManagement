// packages/sync-protocol/test/stop-role-raw.test.ts
// Contract for classifyRawStopRole -- the composed parse-then-classify entry
// point that DB read paths actually need.
//
// WHY THIS EXISTS RATHER THAN LETTING CALLERS COMPOSE IT. Five call sites in
// apps/api read stop.stop_type as a raw varchar(32) string and must turn it into
// a semantic role: two pickup lookups and two delivery lookups in
// transport-orders.service.ts, and the slot filter in
// transport-orders-export.service.ts. Every one of them had grown its own
// version of the same two steps -- .toLowerCase() then compare against
// 'delivery' || 'dropoff' -- which is precisely the per-call-site duplication
// the SSOT rule forbids. Exposing only StopTypeSchema and classifyStopRole would
// leave each caller to pair them again, five times, with five chances to pair
// them differently.
//
// WHY IT RETURNS null RATHER THAN THROWING. These are READ paths that render the
// dispatch board and build the Excel export. StopTypeSchema.parse would throw on
// a single unrecognised row and blank the ENTIRE board for every user -- a
// catastrophic failure mode for a display query. null propagates instead, which
// is the rule computeWeightDiffKg already documents: never report a partial
// aggregate as if complete. An unclassifiable stop matches no slot and
// contributes to no total, rather than being silently miscounted as a pickup.
//
// WHY NOT FAIL-SAFE-TO-PICKUP. The delivery-capture gate deliberately classifies
// unknown types as 'pickup', because for a PHOTO GATE that is conservative: it
// adds an obligation and cannot be bypassed. For these paths the same default
// would be actively wrong -- an unknown stop counted as a pickup skews the
// weight reconciliation and, once the accounting columns land, the billable
// total. Same question, different consequence, so a different answer.
import { describe, it, expect } from 'vitest';
import { STOP_TYPES, STOP_ROLES, classifyRawStopRole } from '../src/dispatch-stop-view-contract.js';

describe('classifyRawStopRole accepts what the database actually stores', () => {
  it('classifies every persisted value to a declared role', () => {
    for (const t of STOP_TYPES) {
      const role = classifyRawStopRole(t);
      expect(role).not.toBeNull();
      expect(STOP_ROLES).toContain(role);
    }
  });

  it('maps pickup to pickup', () => {
    expect(classifyRawStopRole('pickup')).toBe('pickup');
  });

  it('maps both delivery spellings to delivery', () => {
    expect(classifyRawStopRole('delivery')).toBe('delivery');
    expect(classifyRawStopRole('dropoff')).toBe('delivery');
  });

  it('keeps return separate -- a returned load is not delivered', () => {
    expect(classifyRawStopRole('return')).toBe('return');
  });
});

describe('classifyRawStopRole normalizes before classifying', () => {
  it('folds case, so a legacy mixed-case row still classifies', () => {
    expect(classifyRawStopRole('Delivery')).toBe('delivery');
    expect(classifyRawStopRole('DropOff')).toBe('delivery');
    expect(classifyRawStopRole('PICKUP')).toBe('pickup');
  });

  it('trims surrounding whitespace', () => {
    expect(classifyRawStopRole('  delivery  ')).toBe('delivery');
    expect(classifyRawStopRole('pickup\n')).toBe('pickup');
  });
});

describe('classifyRawStopRole returns null rather than guessing', () => {
  it('returns null for a value outside the vocabulary', () => {
    expect(classifyRawStopRole('transfer')).toBeNull();
    expect(classifyRawStopRole('delivrey')).toBeNull();
  });

  it('returns null for an empty or whitespace-only value', () => {
    expect(classifyRawStopRole('')).toBeNull();
    expect(classifyRawStopRole('   ')).toBeNull();
  });

  it('does NOT fall back to pickup -- the gate default would skew every total', () => {
    expect(classifyRawStopRole('transfer')).not.toBe('pickup');
  });

  it('does NOT fall back to delivery -- that would bill a mystery stop', () => {
    expect(classifyRawStopRole('transfer')).not.toBe('delivery');
  });
});
