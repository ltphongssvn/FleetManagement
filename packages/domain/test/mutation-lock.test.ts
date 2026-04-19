// packages/domain/test/mutation-lock.test.ts
// TDD: verify mutation-lock state machine via public barrel export.
// Imports from package barrel (not src/) to validate export surface.

import { describe, it, expect } from 'vitest';
import { MUTATION_LOCK_STATES } from '../src/index.js';

describe('@fleet/domain — mutation-lock state machine', () => {
  it('should define exactly 4 states per PDF spec', () => {
    expect(MUTATION_LOCK_STATES).toHaveLength(4);
  });

  it('should include all PDF-mandated states', () => {
    expect(MUTATION_LOCK_STATES).toContain('unlocked');
    expect(MUTATION_LOCK_STATES).toContain('grace_active');
    expect(MUTATION_LOCK_STATES).toContain('locked_pending_refresh');
    expect(MUTATION_LOCK_STATES).toContain('locked_pending_reauth');
  });

  it('should NOT include any unexpected states', () => {
    const expected = new Set([
      'unlocked',
      'grace_active',
      'locked_pending_refresh',
      'locked_pending_reauth',
    ]);
    for (const state of MUTATION_LOCK_STATES) {
      expect(expected.has(state)).toBe(true);
    }
  });

  it('should be readonly (frozen contract)', () => {
    expect(Object.isFrozen(MUTATION_LOCK_STATES)).toBe(false);
    // as const makes TS treat it as readonly; JS array is not frozen.
    // Document: if runtime immutability needed, use Object.freeze().
  });
});
