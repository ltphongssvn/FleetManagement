// apps/api/test/commands-gateway-depotid-schema.test.ts
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

function makeSocket(auth: Record<string, unknown>): FakeSocket {
  return {
    id: 's1',
    handshake: { auth, headers: {} },
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
}

function makeGw(): CommandsGateway {
  const idp: IIdentityProvider = { verifyToken: vi.fn().mockResolvedValue(validIdentity) };
  return new CommandsGateway(undefined, undefined, undefined, idp, new OperatorContextFactory());
}

describe('@fleet/api - depotId handshake schema validation', () => {
  it('joins depot room when depotId is a valid non-empty string', async () => {
    const gw = makeGw();
    const sock = makeSocket({ token: 'good', depotId: 'depot-A' });
    await gw.handleConnection(sock as never);
    expect(sock.joined).toContain('depot:depot-A');
  });

  it('skips depot room when depotId is missing (operator-only connection)', async () => {
    const gw = makeGw();
    const sock = makeSocket({ token: 'good' });
    await gw.handleConnection(sock as never);
    expect(sock.joined.some((r) => r.startsWith('depot:'))).toBe(false);
  });

  it('skips depot room when depotId is an object (rejects type confusion)', async () => {
    const gw = makeGw();
    const sock = makeSocket({ token: 'good', depotId: { evil: 'payload' } });
    await gw.handleConnection(sock as never);
    expect(sock.joined.some((r) => r.startsWith('depot:'))).toBe(false);
  });

  it('skips depot room when depotId is empty string', async () => {
    const gw = makeGw();
    const sock = makeSocket({ token: 'good', depotId: '' });
    await gw.handleConnection(sock as never);
    expect(sock.joined.some((r) => r.startsWith('depot:'))).toBe(false);
  });

  it('skips depot room when depotId is a number (rejects coercion)', async () => {
    const gw = makeGw();
    const sock = makeSocket({ token: 'good', depotId: 42 });
    await gw.handleConnection(sock as never);
    expect(sock.joined.some((r) => r.startsWith('depot:'))).toBe(false);
  });
});
