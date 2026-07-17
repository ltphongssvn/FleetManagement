// apps/api/test/commands.gateway.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { type INestApplication } from '@nestjs/common';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../src/config/env.config.js';
import { CommandsModule } from '../src/commands/commands.module.js';
import { PUSH_PROVIDER } from '../src/push/push-provider.interface.js';
import { CommandsGateway } from '../src/commands/commands.gateway.js';
import type { CommandPayload } from '../src/commands/command.dto.js';
import { createCommandPayload } from '@fleet/test-fixtures';
import { IDENTITY_PROVIDER, type IIdentityProvider, type VerifiedIdentity } from '../src/auth/identity-provider.interface.js';

function fakeIdp(): IIdentityProvider {
  return {
    verifyToken: async (token: string): Promise<VerifiedIdentity> => {
      // Token format: "tok-<operatorId>" — test-only
      const operatorId = token.startsWith('tok-') ? token.slice(4) : '';
      if (operatorId === '') throw new Error('invalid test token');
      return Promise.resolve({
        subject: 'sub-' + operatorId,
        operatorId,
        companyId: '00000000-0000-0000-0000-000000000003',
        issuedAt: 1000,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
    },
  };
}

describe('@fleet/api - CommandsGateway (e2e)', () => {
  let app: INestApplication;
  let gateway: CommandsGateway;
  let port: number;

  beforeAll(async () => {
    process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/unused';
    process.env['OIDC_ISSUER'] ??= 'https://idp.example.com/';
    process.env['OIDC_AUDIENCE'] ??= 'fleet-api';
    process.env['OIDC_JWKS_URI'] ??= 'https://idp.example.com/.well-known/jwks.json';
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }), CommandsModule],
    })
      .overrideProvider(PUSH_PROVIDER)
      .useValue({ sendToOperator: () => Promise.resolve({ accepted: 0, rejected: 0 }) })
      .overrideProvider(IDENTITY_PROVIDER)
      .useValue(fakeIdp())
      .compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0);
    const addr = app.getHttpServer().address() as AddressInfo;
    port = addr.port;
    gateway = moduleRef.get(CommandsGateway);
  });

  afterAll(async () => {
    await app.close();
  });

  function connect(operatorId: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const s = ioClient(`http://localhost:${String(port)}`, {
        auth: { token: 'tok-' + operatorId },
        transports: ['websocket'],
        reconnection: false,
      });
      s.once('connect', () => { resolve(s); });
      s.once('connect_error', reject);
    });
  }

  it('delivers command to operator room and receives ack', async () => {
    gateway.clearPending();
    const operatorId = '00000000-0000-0000-0000-000000000002';
    const client = await connect(operatorId);

    const cmd: CommandPayload = createCommandPayload({
      commandId: '00000000-0000-0000-0000-000000000aa1',
      targetOperatorId: operatorId,
      aggregateId: '00000000-0000-0000-0000-000000000bb1',
      payload: { roadRunId: 'rr-1' },
    });

    const received = new Promise<CommandPayload>((resolve) => {
      client.once('command', (got: CommandPayload) => { resolve(got); });
    });

    await new Promise((r) => { setTimeout(r, 50); });
    const result = gateway.pushCommand(cmd);
    expect(result.status).toBe('emitted');
    if (result.status === 'emitted') expect(result.recipientCount).toBe(1);

    const got = await received;
    expect(got.commandId).toBe(cmd.commandId);

    client.emit('command_ack', {
      commandId: cmd.commandId,
      ackedAt: new Date().toISOString(),
      status: 'received',
    });

    await new Promise((r) => { setTimeout(r, 100); });
    expect(gateway.pendingCount()).toBe(0);
    expect(gateway.getLatencySamples().length).toBeGreaterThan(0);
    client.close();
  }, 15_000);

  it('returns no_socket when no socket in operator room', () => {
    gateway.clearPending();
    const cmd: CommandPayload = createCommandPayload({
      commandId: '00000000-0000-0000-0000-000000000aa2',
      targetOperatorId: '00000000-0000-0000-0000-0000000000ff',
      aggregateId: '00000000-0000-0000-0000-000000000bb2',
    });
    const result = gateway.pushCommand(cmd);
    expect(result.status).toBe('no_socket');
    // no_socket commands are queued in pending so the reconciler can trigger
    // push fallback (PDF "Push: Expo Push fallback for offline-to-online wake").
    expect(gateway.pendingCount()).toBe(1);
  });

  it('rejects ack from operator who is not the target', async () => {
    gateway.clearPending();
    const targetOperatorId = '11111111-1111-4111-8111-111111111111';
    const otherOperatorId = '22222222-2222-4222-8222-222222222222';
    const target = await connect(targetOperatorId);
    const other = await connect(otherOperatorId);

    const cmd: CommandPayload = createCommandPayload({
      commandId: '33333333-3333-4333-8333-333333333333',
      targetOperatorId,
      aggregateId: '44444444-4444-4444-8444-444444444444',
    });

    await new Promise((r) => { setTimeout(r, 50); });
    gateway.pushCommand(cmd);
    expect(gateway.pendingCount()).toBe(1);

    // Other operator tries to ack
    const ackResponse = await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      other.emit(
        'command_ack',
        { commandId: cmd.commandId, ackedAt: new Date().toISOString(), status: 'received' },
        (r: { ok: boolean; reason?: string }) => { resolve(r); },
      );
    });
    expect(ackResponse.ok).toBe(false);
    expect(ackResponse.reason).toBe('operator_mismatch');
    expect(gateway.pendingCount()).toBe(1);

    target.close();
    other.close();
  }, 15_000);
});
