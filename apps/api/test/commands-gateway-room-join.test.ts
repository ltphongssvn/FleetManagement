// apps/api/test/commands-gateway-room-join.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CommandsGateway } from '../src/commands/commands.gateway.js';
import { OperatorContextFactory } from '../src/auth/operator-context.factory.js';
import type {
  IIdentityProvider,
  VerifiedIdentity,
} from '../src/auth/identity-provider.interface.js';

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
  join(room: string): void;
  disconnect(close?: boolean): void;
}

function makeSocket(
  auth: Record<string, unknown>,
  headers: Record<string, string | undefined> = {},
): FakeSocket {
  const sock: FakeSocket = {
    id: 's1',
    handshake: { auth, headers },
    data: {},
    joined: [],
    disconnected: false,
    join(room) {
      this.joined.push(room);
    },
    disconnect() {
      this.disconnected = true;
    },
  };
  return sock;
}

describe('@fleet/api - handleConnection room join', () => {
  it('valid auth joins operator room derived from verified identity', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(validIdentity) };
    const factory = new OperatorContextFactory();
    const gw = new CommandsGateway(undefined, undefined, undefined, idp, factory);
    const sock = makeSocket({ token: 'good' });
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(false);
    expect(sock.joined).toContain('operator:' + validIdentity.operatorId);
  });

  it('valid auth + depotId joins both operator and depot rooms', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(validIdentity) };
    const factory = new OperatorContextFactory();
    const gw = new CommandsGateway(undefined, undefined, undefined, idp, factory);
    const sock = makeSocket({ token: 'good', depotId: 'depot-A' });
    await gw.handleConnection(sock as never);
    expect(sock.joined).toEqual(
      expect.arrayContaining(['operator:' + validIdentity.operatorId, 'depot:depot-A']),
    );
  });

  it('invalid auth disconnects socket without joining any room', async () => {
    const idp: IIdentityProvider = { verifyToken: vi.fn().mockRejectedValue(new Error('expired')) };
    const factory = new OperatorContextFactory();
    const gw = new CommandsGateway(undefined, undefined, undefined, idp, factory);
    const sock = makeSocket({ token: 'bad' });
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(true);
    expect(sock.joined).toEqual([]);
  });
});
