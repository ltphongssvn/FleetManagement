// apps/api/test/owner-role.guard.test.ts
// RED: OwnerRoleGuard. Thin HTTP adapter over decideOwnerAccess. Reads the
// roles carried on req.identity (set by JwtGuard), delegates the decision to
// the pure policy, throws ForbiddenException on deny, throws Unauthorized when
// JwtGuard has not run. Uses a fake ExecutionContext (no Nest bootstrap).
import { describe, it, expect } from 'vitest';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { OwnerRoleGuard } from '../src/owner/owner-role.guard.js';
import { FLEET_OWNER_ROLE } from '../src/owner/owner-role-policy.js';

function ctxWith(identity: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ identity }) }),
  } as unknown as ExecutionContext;
}

describe('@fleet/api - OwnerRoleGuard', () => {
  const guard = new OwnerRoleGuard();

  it('allows a request whose identity carries the fleet-owner role', () => {
    const ctx = ctxWith({ roles: [FLEET_OWNER_ROLE] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('forbids a request whose identity lacks the role', () => {
    const ctx = ctxWith({ roles: ['dispatcher'] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('forbids a request whose identity has no roles at all', () => {
    const ctx = ctxWith({ operatorId: 'op-1' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects as unauthorized when JwtGuard has not attached an identity', () => {
    const ctx = ctxWith(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
