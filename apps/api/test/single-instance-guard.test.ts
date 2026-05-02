// apps/api/test/single-instance-guard.test.ts
import { describe, it, expect } from 'vitest';
import { assertSingleInstance } from '../src/runtime/single-instance-guard.js';

describe('@fleet/api - assertSingleInstance', () => {
  it('is a no-op when EXPECTED_INSTANCE_COUNT is unset (local/test default)', () => {
    expect(() => { assertSingleInstance({}); }).not.toThrow();
  });

  it('is a no-op when EXPECTED_INSTANCE_COUNT=1', () => {
    expect(() => { assertSingleInstance({ EXPECTED_INSTANCE_COUNT: '1' }); }).not.toThrow();
  });

  it('throws when EXPECTED_INSTANCE_COUNT>1 (pilot invariant: single-node Socket.IO per PDF Day-One §6)', () => {
    expect(() => { assertSingleInstance({ EXPECTED_INSTANCE_COUNT: '2' }); }).toThrow(
      /single-instance invariant violated/i,
    );
  });

  it('throws when EXPECTED_INSTANCE_COUNT is non-numeric (fail-fast on misconfiguration)', () => {
    expect(() => { assertSingleInstance({ EXPECTED_INSTANCE_COUNT: 'abc' }); }).toThrow(
      /EXPECTED_INSTANCE_COUNT must be a positive integer/i,
    );
  });

  it('includes FLY_MACHINE_ID in error for traceability when running on Fly', () => {
    expect(() => {
      assertSingleInstance({ EXPECTED_INSTANCE_COUNT: '3', FLY_MACHINE_ID: 'mach-abc123' });
    },
    ).toThrow(/mach-abc123/);
  });
});
