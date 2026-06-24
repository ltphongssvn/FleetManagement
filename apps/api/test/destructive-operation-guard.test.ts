// apps/api/test/destructive-operation-guard.test.ts
//
// L2 unit contract for the policy-as-code production destructive-operation guard
// (layer 6 of the layered DB-protection design). Asserts the guard is SCHEMA-FIRST,
// FAIL-CLOSED in production, and gated only by an explicit typed break-glass that NAMES
// production. The wipeBusinessData integration enforcement is covered separately.
import { describe, it, expect } from 'vitest';
import {
  evaluateDestructiveOperation,
  assertDestructiveOperationAllowed,
  resolveGuardEnvironment,
  DestructiveOperationBlockedError,
  DestructiveOperationSchema,
  GuardDecisionSchema,
  type DestructiveOperation,
  type BreakGlassAuthorization,
} from '../src/maintenance/destructive-operation-guard.js';

function breakGlassFor(env: BreakGlassAuthorization['confirmedEnvironment']): BreakGlassAuthorization {
  return { confirmedEnvironment: env, reason: 'approved incident INC-1234 maintenance window' };
}
function op(over: Partial<DestructiveOperation>): DestructiveOperation {
  return DestructiveOperationSchema.parse({
    operation: 'wipe_business_data',
    environment: 'production',
    tableCount: 14,
    authorization: null,
    ...over,
  });
}

describe('DestructiveOperation contract (schema-first)', () => {
  it('rejects an unknown operation', () => {
    expect(() => DestructiveOperationSchema.parse({ operation: 'rm_rf', environment: 'production', tableCount: 1, authorization: null })).toThrow();
  });
  it('rejects an unknown environment (kills enum widening)', () => {
    expect(() => DestructiveOperationSchema.parse({ operation: 'truncate', environment: 'prod', tableCount: 1, authorization: null })).toThrow();
  });
  it('GuardDecisionSchema narrows on the allowed discriminator', () => {
    expect(GuardDecisionSchema.parse({ allowed: true }).allowed).toBe(true);
    const denied = GuardDecisionSchema.parse({ allowed: false, reason: 'blocked_in_production', message: 'x' });
    expect(denied.allowed).toBe(false);
  });
});

describe('resolveGuardEnvironment (trusted, fail-closed)', () => {
  it('maps NODE_ENV=development to development', () => {
    expect(resolveGuardEnvironment({ NODE_ENV: 'development' })).toBe('development');
  });
  it('maps NODE_ENV=test to test', () => {
    expect(resolveGuardEnvironment({ NODE_ENV: 'test' })).toBe('test');
  });
  it('maps NODE_ENV=production to production', () => {
    expect(resolveGuardEnvironment({ NODE_ENV: 'production' })).toBe('production');
  });
  it('RAILWAY_ENVIRONMENT_NAME=production FORCES production even if NODE_ENV says dev', () => {
    // The dangerous misconfig: a prod box with NODE_ENV unset/wrong. Fail-closed.
    expect(resolveGuardEnvironment({ NODE_ENV: 'development', RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe('production');
  });
  it('treats an unrecognized NODE_ENV as production (deny-by-default)', () => {
    expect(resolveGuardEnvironment({ NODE_ENV: 'staging-ish-typo' })).toBe('production');
  });
  it('treats NO signals as production (deny-by-default)', () => {
    expect(resolveGuardEnvironment({})).toBe('production');
  });
});

describe('evaluateDestructiveOperation (pure, fail-closed)', () => {
  it('BLOCKS wipe in production with no authorization', () => {
    const d = evaluateDestructiveOperation(op({ environment: 'production', authorization: null }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('blocked_in_production');
  });
  it('BLOCKS in production when the break-glass names the WRONG environment', () => {
    const d = evaluateDestructiveOperation(op({ environment: 'production', authorization: breakGlassFor('staging') }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('authorization_environment_mismatch');
  });
  it('ALLOWS in production ONLY with a break-glass that names production', () => {
    const d = evaluateDestructiveOperation(op({ environment: 'production', authorization: breakGlassFor('production') }));
    expect(d.allowed).toBe(true);
  });
  it('ALLOWS in development with no authorization', () => {
    expect(evaluateDestructiveOperation(op({ environment: 'development', authorization: null })).allowed).toBe(true);
  });
  it('ALLOWS in test with no authorization', () => {
    expect(evaluateDestructiveOperation(op({ environment: 'test', authorization: null })).allowed).toBe(true);
  });
  it('ALLOWS in staging with no authorization', () => {
    expect(evaluateDestructiveOperation(op({ environment: 'staging', authorization: null })).allowed).toBe(true);
  });
});

describe('assertDestructiveOperationAllowed (throwing boundary)', () => {
  it('throws DestructiveOperationBlockedError when blocked in production', () => {
    expect(() => {
      assertDestructiveOperationAllowed(op({ environment: 'production', authorization: null }));
    }).toThrow(DestructiveOperationBlockedError);
  });
  it('the error message names the environment and operation (actionable)', () => {
    try {
      assertDestructiveOperationAllowed(op({ environment: 'production', authorization: null }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DestructiveOperationBlockedError);
      expect((e as Error).message).toContain('production');
      expect((e as Error).message).toContain('wipe_business_data');
    }
  });
  it('does NOT throw in development', () => {
    expect(() => {
      assertDestructiveOperationAllowed(op({ environment: 'development', authorization: null }));
    }).not.toThrow();
  });
  it('does NOT throw in production WITH a production-named break-glass', () => {
    expect(() => {
      assertDestructiveOperationAllowed(op({ environment: 'production', authorization: breakGlassFor('production') }));
    }).not.toThrow();
  });
});
