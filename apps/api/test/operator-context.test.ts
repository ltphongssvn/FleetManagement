// apps/api/test/operator-context.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OperatorContextFactory, PILOT_TENANCY_SENTINEL } from '../src/auth/operator-context.factory.js';
import {
  AuthError,
  IdentityExpiredError,
  MissingCompanyIdError,
  MissingOperatorIdError,
} from '../src/auth/auth.errors.js';
import type { VerifiedIdentity } from '../src/auth/identity-provider.interface.js';

const futureExp = (): number => Math.floor(Date.now() / 1000) + 3600;

function buildIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return {
    subject: 'user-1',
    operatorId: '00000000-0000-0000-0000-000000000002',
    companyId: '00000000-0000-0000-0000-000000000003',
    issuedAt: 1700000000,
    expiresAt: futureExp(),
    ...overrides,
  };
}

describe('@fleet/api - OperatorContextFactory', () => {
  const factory = new OperatorContextFactory();

  it('derives OperatorContext from VerifiedIdentity claims', () => {
    const identity = buildIdentity();
    const ctx = factory.fromIdentity(identity);
    expect(ctx.operatorId).toBe(identity.operatorId);
    expect(ctx.companyId).toBe(identity.companyId);
  });

  it('throws MissingOperatorIdError when operatorId blank', () => {
    expect(() => factory.fromIdentity(buildIdentity({ operatorId: '' }))).toThrow(MissingOperatorIdError);
  });

  it('throws MissingOperatorIdError when operatorId is non-UUID', () => {
    expect(() => factory.fromIdentity(buildIdentity({ operatorId: 'not-a-uuid' }))).toThrow(MissingOperatorIdError);
  });

  it('throws MissingCompanyIdError when companyId blank', () => {
    expect(() => factory.fromIdentity(buildIdentity({ companyId: '' }))).toThrow(MissingCompanyIdError);
  });

  it('throws MissingCompanyIdError when companyId is non-UUID', () => {
    expect(() => factory.fromIdentity(buildIdentity({ companyId: 'abc' }))).toThrow(MissingCompanyIdError);
  });

  it('throws IdentityExpiredError when exp is in the past', () => {
    const expired = buildIdentity({ expiresAt: 1700000000, issuedAt: 1699996400 });
    expect(() => factory.fromIdentity(expired)).toThrow(IdentityExpiredError);
  });

  it('all auth errors extend AuthError base', () => {
    expect(new MissingOperatorIdError()).toBeInstanceOf(AuthError);
    expect(new MissingCompanyIdError()).toBeInstanceOf(AuthError);
    expect(new IdentityExpiredError(1, 2)).toBeInstanceOf(AuthError);
  });

  it('uses PILOT_TENANCY_SENTINEL for tenancy claims not yet emitted by IDP', () => {
    const ctx = factory.fromIdentity(buildIdentity());
    expect(ctx.businessUnitId).toBe(PILOT_TENANCY_SENTINEL);
    expect(ctx.depotId).toBe(PILOT_TENANCY_SENTINEL);
    expect(ctx.legalEntityId).toBe(PILOT_TENANCY_SENTINEL);
  });

  it('PILOT_TENANCY_SENTINEL is the all-zero UUID (greppable in audits)', () => {
    expect(PILOT_TENANCY_SENTINEL).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('returns frozen OperatorContext (immutability invariant)', () => {
    const ctx = factory.fromIdentity(buildIdentity());
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  describe('property-based invariants', () => {
    it('any future expiration with valid claims yields a context with matching operator/company', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.uuid(),
          fc.integer({ min: 60, max: 86_400 }),
          (operatorId, companyId, ttlSec) => {
            const identity = buildIdentity({
              operatorId,
              companyId,
              expiresAt: Math.floor(Date.now() / 1000) + ttlSec,
            });
            const ctx = factory.fromIdentity(identity);
            return ctx.operatorId === operatorId && ctx.companyId === companyId;
          },
        ),
        { numRuns: 50 },
      );
    });

    it('any past expiration always throws IdentityExpiredError', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1_000_000 }),
          (secondsAgo) => {
            const identity = buildIdentity({
              expiresAt: Math.floor(Date.now() / 1000) - secondsAgo,
            });
            try {
              factory.fromIdentity(identity);
              return false;
            } catch (err) {
              return err instanceof IdentityExpiredError;
            }
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
