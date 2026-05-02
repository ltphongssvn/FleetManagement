// apps/api/test/ws-jwt.guard.test.ts
import { describe, it, expect, vi } from 'vitest';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { WsJwtGuard, type AuthenticatedSocketData } from '../src/auth/ws-jwt.guard.js';
import { OperatorContextFactory } from '../src/auth/operator-context.factory.js';
import type { IIdentityProvider, VerifiedIdentity } from '../src/auth/identity-provider.interface.js';

interface FakeSocket {
  handshake: { auth: Record<string, unknown>; headers: Record<string, string | undefined> };
  data: Record<string, unknown>;
}

function makeWsCtx(socket: FakeSocket): ExecutionContext {
  return {
    switchToWs: () => ({ getClient: () => socket }),
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

describe('@fleet/api - WsJwtGuard', () => {
  it('rejects when no token in handshake.auth.token nor Authorization header', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn() };
    const guard = new WsJwtGuard(idp, factory);
    const sock: FakeSocket = { handshake: { auth: {}, headers: {} }, data: {} };
    await expect(guard.canActivate(makeWsCtx(sock))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when verifyToken throws', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockRejectedValue(new Error('expired')) };
    const guard = new WsJwtGuard(idp, factory);
    const sock: FakeSocket = { handshake: { auth: { token: 'x.y.z' }, headers: {} }, data: {} };
    await expect(guard.canActivate(makeWsCtx(sock))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('reads token from handshake.auth.token (preferred path)', async () => {
    const verifyToken = vi.fn().mockResolvedValue(validIdentity);
    const guard = new WsJwtGuard({ verifyToken }, factory);
    const sock: FakeSocket = { handshake: { auth: { token: 'tok-a' }, headers: {} }, data: {} };
    const ok = await guard.canActivate(makeWsCtx(sock));
    expect(ok).toBe(true);
    expect(verifyToken).toHaveBeenCalledWith('tok-a');
  });

  it('falls back to Authorization Bearer header when handshake.auth.token absent', async () => {
    const verifyToken = vi.fn().mockResolvedValue(validIdentity);
    const guard = new WsJwtGuard({ verifyToken }, factory);
    const sock: FakeSocket = {
      handshake: { auth: {}, headers: { authorization: 'Bearer tok-b' } },
      data: {},
    };
    const ok = await guard.canActivate(makeWsCtx(sock));
    expect(ok).toBe(true);
    expect(verifyToken).toHaveBeenCalledWith('tok-b');
  });

  it('attaches typed AuthenticatedSocketData to client.data on success', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(validIdentity) };
    const guard = new WsJwtGuard(idp, factory);
    const sock: FakeSocket = { handshake: { auth: { token: 'good' }, headers: {} }, data: {} };
    await guard.canActivate(makeWsCtx(sock));
    const data = sock.data as unknown as AuthenticatedSocketData;
    expect(data.identity).toEqual(validIdentity);
    expect(data.fleetOperator.operatorId).toBe(validIdentity.operatorId);
    expect(data.fleetOperator.companyId).toBe(validIdentity.companyId);
  });

  it('rejects non-Bearer Authorization header', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn() };
    const guard = new WsJwtGuard(idp, factory);
    const sock: FakeSocket = { handshake: { auth: {}, headers: { authorization: 'Basic xyz' } }, data: {} };
    await expect(guard.canActivate(makeWsCtx(sock))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when factory throws on invalid claims', async () => {
    const invalid: VerifiedIdentity = { ...validIdentity, operatorId: '' };
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(invalid) };
    const guard = new WsJwtGuard(idp, factory);
    const sock: FakeSocket = { handshake: { auth: { token: 'bad-claims' }, headers: {} }, data: {} };
    await expect(guard.canActivate(makeWsCtx(sock))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
