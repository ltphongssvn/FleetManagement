// packages/domain/test/cancel-order-input.test.ts
// RED-first (cancel-requires-reason, 2026): the cancellation INPUT contract
// is one SSOT in @fleet/domain, shared by the API DTO and the ops-web action
// (previously two hand-written z.objects that had drifted). It carries the
// business invariant: a cancellation must record WHY. An enumerated reason is
// itself the recorded why; the open-ended other bucket is only a real reason
// when accompanied by a non-empty free-text note. So reason===other REQUIRES
// note; every enumerated reason keeps note optional.
import { describe, it, expect } from 'vitest';
import {
  CancelOrderInputSchema,
  type CancelOrderInput,
} from '../src/transport/cancel-order-input.js';
describe('@fleet/domain - CancelOrderInputSchema', () => {
  it('accepts an enumerated reason with no note', () => {
    const r = CancelOrderInputSchema.safeParse({ reason: 'customer_request' });
    expect(r.success).toBe(true);
  });
  it('accepts an enumerated reason with a note', () => {
    const r = CancelOrderInputSchema.safeParse({ reason: 'weather', note: 'bão' });
    expect(r.success).toBe(true);
  });
  it('REJECTS reason=other with no note (the recorded-why invariant)', () => {
    const r = CancelOrderInputSchema.safeParse({ reason: 'other' });
    expect(r.success).toBe(false);
  });
  it('REJECTS reason=other with an empty/whitespace note', () => {
    expect(CancelOrderInputSchema.safeParse({ reason: 'other', note: '' }).success).toBe(false);
    expect(CancelOrderInputSchema.safeParse({ reason: 'other', note: '   ' }).success).toBe(false);
  });
  it('accepts reason=other WITH a non-empty note', () => {
    const r = CancelOrderInputSchema.safeParse({ reason: 'other', note: 'khách đổi lịch' });
    expect(r.success).toBe(true);
  });
  it('flags the note path on the other-without-note error', () => {
    const r = CancelOrderInputSchema.safeParse({ reason: 'other' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'note')).toBe(true);
    }
  });
  it('rejects a note over 500 chars', () => {
    const long = 'x'.repeat(501);
    expect(CancelOrderInputSchema.safeParse({ reason: 'weather', note: long }).success).toBe(false);
  });
  it('rejects unknown keys (strict envelope)', () => {
    const r = CancelOrderInputSchema.safeParse({ reason: 'weather', extra: 1 });
    expect(r.success).toBe(false);
  });
  it('type narrows', () => {
    const v: CancelOrderInput = { reason: 'duplicate' };
    expect(v.reason).toBe('duplicate');
  });
});
