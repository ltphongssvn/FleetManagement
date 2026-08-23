// apps/api/test/jwt.guard.test.ts
import { describe, it, expect, vi } from 'vitest';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtGuard } from '../src/auth/jwt.guard.js';
import { OperatorContextFactory } from '../src/auth/operator-context.factory.js';
import type {
  IIdentityProvider,
  VerifiedIdentity,
} from '../src/auth/identity-provider.interface.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

function makeCtx(headers: Record<string, string | undefined>): ExecutionContext {
  const req = { headers } as unknown as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const validIdentity: VerifiedIdentity = {
  subject: 'user-1',
  operatorId: '00000000-0000-0000-0000-000000000002',
  companyId: '00000000-0000-0000-0000-000000000003',
  issuedAt: 1000,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};

const factory = new OperatorContextFactory();

describe('@fleet/api - JwtGuard', () => {
  it('rejects missing authorization header', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn() };
    const guard = new JwtGuard(idp, factory);
    await expect(guard.canActivate(makeCtx({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects non-Bearer authorization header', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn() };
    const guard = new JwtGuard(idp, factory);
    await expect(guard.canActivate(makeCtx({ authorization: 'Basic abc' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when verifyToken throws', async () => {
    const idp: IIdentityProvider = {
      verifyToken: vi.fn().mockRejectedValue(new Error('expired')),
    };
    const guard = new JwtGuard(idp, factory);
    await expect(
      guard.canActivate(makeCtx({ authorization: 'Bearer x.y.z' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns true, attaches identity, and attaches fleetOperator on success', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(validIdentity) };
    const guard = new JwtGuard(idp, factory);
    const ctx = makeCtx({ authorization: 'Bearer good-token' });
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    const req = ctx.switchToHttp().getRequest<{
      identity: VerifiedIdentity;
      fleetOperator: OperatorContext;
    }>();
    expect(req.identity).toEqual(validIdentity);
    expect(req.fleetOperator.operatorId).toBe(validIdentity.operatorId);
    expect(req.fleetOperator.companyId).toBe(validIdentity.companyId);
  });

  it('passes raw token to verifyToken (no Bearer prefix)', async () => {
    const verifyToken = vi.fn().mockResolvedValue(validIdentity);
    const guard = new JwtGuard({ verifyToken }, factory);
    await guard.canActivate(makeCtx({ authorization: 'Bearer my-token' }));
    expect(verifyToken).toHaveBeenCalledWith('my-token');
  });

  it('rejects when factory throws (e.g. invalid claims)', async () => {
    const invalidIdentity: VerifiedIdentity = { ...validIdentity, operatorId: '' };
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(invalidIdentity) };
    const guard = new JwtGuard(idp, factory);
    await expect(
      guard.canActivate(makeCtx({ authorization: 'Bearer bad-claims' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
