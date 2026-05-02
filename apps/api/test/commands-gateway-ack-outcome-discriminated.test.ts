// apps/api/test/commands-gateway-ack-outcome-discriminated.test.ts
import { describe, it, expect } from 'vitest';
import type { AckOutcome } from '../src/commands/commands.gateway.js';

describe('@fleet/api - AckOutcome discriminated union', () => {
  it('failure branch reason is required at type level', () => {
    // @ts-expect-error reason is required when ok=false
    const bad: AckOutcome = { ok: false };
    expect(bad).toBeDefined();
  });

  it('failure branch with reason carries discriminated reason field', () => {
    const fn = (): AckOutcome => ({ ok: false, reason: 'unknown_command' });
    const ok = fn();
    if (!ok.ok) expect(ok.reason).toBe('unknown_command');
    else throw new Error('should be failure branch');
  });

  it('success branch serializes without reason field', () => {
    const ok: AckOutcome = { ok: true };
    expect(JSON.stringify(ok)).toBe('{"ok":true}');
  });
});
