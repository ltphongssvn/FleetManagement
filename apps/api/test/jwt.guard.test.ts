// apps/api/test/jwt.guard.test.ts
// Behavioral tests for JwtGuard. IIdentityProvider mocked - no Passport, no jose
// network calls, no ExecutionContext gymnastics.
import { describe, it, expect, vi } from 'vitest';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtGuard } from '../src/auth/jwt.guard.js';
import type { IIdentityProvider, VerifiedIdentity } from '../src/auth/identity-provider.interface.js';

function makeCtx(headers: Record<string, string | undefined>): ExecutionContext {
  const req = { headers } as unknown as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const validIdentity: VerifiedIdentity = {
  subject: 'user-1',
  operatorId: 'op-1',
  companyId: 'co-1',
  issuedAt: 1000,
  expiresAt: 9999,
};

describe('@fleet/api - JwtGuard', () => {
  it('rejects missing authorization header', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn() };
    const guard = new JwtGuard(idp);
    await expect(guard.canActivate(makeCtx({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects non-Bearer authorization header', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn() };
    const guard = new JwtGuard(idp);
    await expect(guard.canActivate(makeCtx({ authorization: 'Basic abc' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when verifyToken throws', async () => {
    const idp: IIdentityProvider = {
      verifyToken: vi.fn().mockRejectedValue(new Error('expired')),
    };
    const guard = new JwtGuard(idp);
    await expect(guard.canActivate(makeCtx({ authorization: 'Bearer x.y.z' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns true and attaches identity on success', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(validIdentity) };
    const guard = new JwtGuard(idp);
    const ctx = makeCtx({ authorization: 'Bearer good-token' });
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    const req = ctx.switchToHttp().getRequest<{ identity: VerifiedIdentity }>();
    expect(req.identity).toEqual(validIdentity);
  });

  it('passes raw token to verifyToken (no Bearer prefix)', async () => {
    const verifyToken = vi.fn().mockResolvedValue(validIdentity);
    const guard = new JwtGuard({ verifyToken });
    await guard.canActivate(makeCtx({ authorization: 'Bearer my-token' }));
    expect(verifyToken).toHaveBeenCalledWith('my-token');
  });
});
