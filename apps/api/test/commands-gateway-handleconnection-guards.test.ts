// apps/api/test/commands-gateway-handleconnection-guards.test.ts
// Kills survivors on lines 159 (idp/factory guard), 169 (token undefined),
// 180-181 (catch path warn + disconnect), 187 (SocketData ObjectLiteral pin).
import { describe, it, expect, vi } from 'vitest';
import { CommandsGateway } from '../src/commands/commands.gateway.js';
import { OperatorContextFactory } from '../src/auth/operator-context.factory.js';
import type { IIdentityProvider, VerifiedIdentity } from '../src/auth/identity-provider.interface.js';

const validIdentity: VerifiedIdentity = {
  subject: 'user-1',
  operatorId: '00000000-0000-0000-0000-000000000002',
  companyId: '00000000-0000-0000-0000-000000000003',
  issuedAt: 1000,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};

interface FakeSocket {
  id: string;
  handshake: { auth: Record<string, unknown>; headers: Record<string, string | undefined> };
  data: Record<string, unknown>;
  joined: string[];
  disconnected: boolean;
  disconnectArg: boolean | undefined;
  join(room: string): void;
  disconnect(close?: boolean): void;
}

function makeSocket(auth: Record<string, unknown>, headers: Record<string, string | undefined> = {}): FakeSocket {
  const sock: FakeSocket = {
    id: 's1',
    handshake: { auth, headers },
    data: {},
    joined: [],
    disconnected: false,
    disconnectArg: undefined,
    join(room) { this.joined.push(room); },
    disconnect(close) { this.disconnected = true; this.disconnectArg = close; },
  };
  return sock;
}

describe('@fleet/api - handleConnection guards', () => {
  it('disconnects with close=true when idp is undefined (kills idp guard + disconnect(true) BooleanLiteral)', async () => {
    const factory = new OperatorContextFactory();
    // idp omitted (undefined), factory present
    const gw = new CommandsGateway(undefined, undefined, undefined, undefined, factory);
    const sock = makeSocket({ token: 'good' });
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(true);
    expect(sock.disconnectArg).toBe(true);
    expect(sock.joined).toEqual([]);
  });

  it('disconnects with close=true when operatorFactory is undefined (kills factory guard side of || + disconnect(true))', async () => {
    const verifySpy = vi.fn().mockResolvedValue(validIdentity);
    const idp: IIdentityProvider = { verifyToken: verifySpy };
    // factory omitted (undefined)
    const gw = new CommandsGateway(undefined, undefined, undefined, idp, undefined);
    const sock = makeSocket({ token: 'good' });
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(true);
    expect(sock.disconnectArg).toBe(true);
    expect(sock.joined).toEqual([]);
    // idp not called because guard short-circuits before token check
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('disconnects with close=true when both idp and factory are undefined (kills && vs || mutation on guard)', async () => {
    // If guard is mutated from || to &&, the function would proceed when only one is undefined.
    // This test pins the guard fires when BOTH are undefined.
    const gw = new CommandsGateway(undefined, undefined, undefined, undefined, undefined);
    const sock = makeSocket({ token: 'good' });
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(true);
    expect(sock.disconnectArg).toBe(true);
  });

  it('disconnects with close=true when token is missing (kills line 169 ConditionalExpression + disconnect(true))', async () => {
    const verifySpy = vi.fn();
    const idp: IIdentityProvider = { verifyToken: verifySpy };
    const factory = new OperatorContextFactory();
    const gw = new CommandsGateway(undefined, undefined, undefined, idp, factory);
    const sock = makeSocket({}); // no token, no Authorization header
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(true);
    expect(sock.disconnectArg).toBe(true);
    expect(sock.joined).toEqual([]);
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('on idp.verifyToken rejection, disconnects with close=true (kills line 181 disconnect(true) BooleanLiteral)', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockRejectedValue(new Error('jwt expired')) };
    const factory = new OperatorContextFactory();
    const gw = new CommandsGateway(undefined, undefined, undefined, idp, factory);
    const sock = makeSocket({ token: 'bad' });
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(true);
    expect(sock.disconnectArg).toBe(true);
    expect(sock.joined).toEqual([]);
  });

  it('on operatorFactory.fromIdentity throw, disconnects with close=true (kills line 181 disconnect(true))', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(validIdentity) };
    const factory = {
      fromIdentity: vi.fn(() => { throw new Error('invalid claims'); }),
    } as unknown as OperatorContextFactory;
    const gw = new CommandsGateway(undefined, undefined, undefined, idp, factory);
    const sock = makeSocket({ token: 'good' });
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(true);
    expect(sock.disconnectArg).toBe(true);
    expect(sock.joined).toEqual([]);
  });

  it('on successful connection, populates ALL four SocketData fields (kills SocketData ObjectLiteral mutant)', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(validIdentity) };
    const factory = new OperatorContextFactory();
    const gw = new CommandsGateway(undefined, undefined, undefined, idp, factory);
    const sock = makeSocket({ token: 'good', depotId: 'depot-Z' });
    await gw.handleConnection(sock as never);
    // SocketData ObjectLiteral mutant replaces { identity, fleetOperator, operatorId, depotId } with {}
    // Assert each field present so the empty-object mutant fails.
    expect(sock.data['identity']).toBeDefined();
    expect(sock.data['fleetOperator']).toBeDefined();
    expect(sock.data['operatorId']).toBe(validIdentity.operatorId);
    expect(sock.data['depotId']).toBe('depot-Z');
  });

  it('on successful connection without depotId, operatorId still populated, depotId is undefined (kills SocketData ObjectLiteral)', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(validIdentity) };
    const factory = new OperatorContextFactory();
    const gw = new CommandsGateway(undefined, undefined, undefined, idp, factory);
    const sock = makeSocket({ token: 'good' });
    await gw.handleConnection(sock as never);
    expect(sock.data['operatorId']).toBe(validIdentity.operatorId);
    expect(sock.data['depotId']).toBeUndefined();
    // identity and fleetOperator must still be set
    expect(sock.data['identity']).toBeDefined();
    expect(sock.data['fleetOperator']).toBeDefined();
  });
});
