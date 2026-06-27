// packages/domain/test/cancel-reason.test.ts
// RED-first (T-cancel-refactor, 2026): single-source-of-truth for the
// transport-order cancellation reason vocabulary. Mirrors the canonical
// manifest-rejection-reason pattern (as const array -> typeof[number] type ->
// z.enum). Written before packages/domain/src/transport/cancel-reason.ts exists,
// so this fails at import resolution until the source + barrel export land.
//
// Why this enum moves into @fleet/domain: the same six values were declared
// independently in apps/api transport-orders.cancel.dto.ts and apps/ops-web
// cancel-order.action.ts, and hardcoded again as REASON_OPTIONS values in
// CancelOrderForm.tsx -> four definitions, already drifted (api note min(1)+
// strict vs web note max-only). One definition here is consumed by all sites.
import { describe, it, expect } from 'vitest';
import {
  CANCEL_REASONS,
  CancelReasonSchema,
  type CancelReason,
} from '../src/transport/cancel-reason.js';

describe('@fleet/domain - CANCEL_REASONS', () => {
  it('exports the canonical 6-value enum in dispatch-priority order', () => {
    expect([...CANCEL_REASONS]).toEqual([
      'customer_request',
      'driver_unavailable',
      'vehicle_breakdown',
      'weather',
      'duplicate',
      'other',
    ]);
  });

  it('CANCEL_REASONS is frozen', () => {
    expect(Object.isFrozen(CANCEL_REASONS)).toBe(true);
  });

  it('Zod schema accepts every canonical value', () => {
    for (const r of CANCEL_REASONS) {
      expect(CancelReasonSchema.safeParse(r).success).toBe(true);
    }
  });

  it('Zod schema rejects unknown values and empty string', () => {
    expect(CancelReasonSchema.safeParse('cancelled').success).toBe(false);
    expect(CancelReasonSchema.safeParse('not_a_reason').success).toBe(false);
    expect(CancelReasonSchema.safeParse('').success).toBe(false);
  });

  it('type narrows to the literal union', () => {
    const r: CancelReason = 'other';
    expect(r).toBe('other');
    const all: CancelReason[] = [
      'customer_request',
      'driver_unavailable',
      'vehicle_breakdown',
      'weather',
      'duplicate',
      'other',
    ];
    expect(all).toContain(r);
  });
});
